/**
 * Docker Container Pool Manager
 * Maintains a pool of pre-created containers for efficient code execution
 * Reduces overhead from container creation/destruction
 */

import Dockerode from 'dockerode';
import fs from 'fs';
import path from 'path';

const docker = new Dockerode();

class ContainerPool {
  constructor(options = {}) {
    this.poolSize = options.poolSize || 2;
    this.containerImage = options.image || 'judge-sandbox';
    this.containers = [];
    this.availableContainers = [];
    this.waitingQueue = [];
    this.containerCounter = 0;
    this.healthCheckInterval = null;
  }

  /**
   * Reuse existing healthy containers from previous pool instances
   */
  async reuseExistingContainers() {
    console.log('♻️  Checking for existing containers to reuse...');
    
    try {
      const containers = await docker.listContainers({ all: true });
      const pooledContainers = containers.filter((c) => {
        const labels = c.Labels || {};
        return labels.judge === 'true' && labels.pool === 'true';
      });

      if (pooledContainers.length === 0) {
        console.log('   No existing containers found, will create new pool');
        return 0;
      }

      console.log(`   Found ${pooledContainers.length} existing container(s), attempting to reuse...`);
      
      let reusedCount = 0;
      for (const containerInfo of pooledContainers) {
        try {
          const container = docker.getContainer(containerInfo.Id);
          
          // Start container if stopped
          if (containerInfo.State !== 'running') {
            await container.start();
            console.log(`   🔄 Restarted: ${containerInfo.Names[0]}`);
          } else {
            console.log(`   ✅ Reusing: ${containerInfo.Names[0]}`);
          }
          
          // Verify health
          const isHealthy = await this.checkContainerHealth(container);
          if (isHealthy) {
            this.containers.push(container);
            this.availableContainers.push(container);
            reusedCount++;
          } else {
            console.log(`   ⚠️  Container ${containerInfo.Names[0]} is unhealthy, removing...`);
            await container.stop({ t: 3 });
            await container.remove({ force: true });
          }
        } catch (error) {
          console.error(`   ⚠️  Failed to reuse ${containerInfo.Names[0]}: ${error.message}`);
        }
      }
      
      if (reusedCount > 0) {
        console.log(`✅ Reused ${reusedCount} existing container(s)`);
      }
      return reusedCount;
    } catch (error) {
      console.error('Error during container reuse:', error.message);
      return 0;
    }
  }

  /**
   * Initialize pool by creating containers
   */
  async initialize() {
    console.log(`🚀 Initializing container pool with ${this.poolSize} containers...`);

    try {
      // Try to reuse existing containers first
      const reusedCount = await this.reuseExistingContainers();

      // Ensure image exists
      await this.ensureImage();

      // Create additional containers if needed
      const containersNeeded = this.poolSize - reusedCount;
      if (containersNeeded > 0) {
        console.log(`📦 Creating ${containersNeeded} new container(s)...`);
        for (let i = 0; i < containersNeeded; i++) {
          try {
            const container = await this.createContainer();
            this.containers.push(container);
            this.availableContainers.push(container);
            console.log(`  ✓ Container ${reusedCount + i + 1}/${this.poolSize} ready`);
          } catch (error) {
            console.error(`  ✗ Failed to create container ${reusedCount + i + 1}:`, error.message);
          }
        }
      }

      // Start health checks
      this.startHealthChecks();

      console.log(`✅ Container pool initialized with ${this.availableContainers.length} containers\n`);

      return this.availableContainers.length;
    } catch (error) {
      console.error('Container pool initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create a single container
   */
  async createContainer() {
    const containerId = ++this.containerCounter;
    const containerName = `judge-sandbox-${containerId}-${Date.now()}`;

    try {
      const container = await docker.createContainer({
        Image: this.containerImage,
        name: containerName,
        Cmd: ['/bin/sleep', '86400'], // Sleep for 24 hours
        HostConfig: {
          // Resource limits
          Memory: 512 * 1024 * 1024, // 512MB
          MemorySwap: 512 * 1024 * 1024, // No swap
          CpuShares: 512, // CPU weight
          PidsLimit: 100, // Max processes
          NetworkMode: 'none', // No network access
          ReadonlyRootfs: false, // Allow writes to temp dirs
          Tmpfs: {
            '/tmp': 'size=256m', // 256MB tmpfs for execution
          },
        },
        Labels: {
          'judge': 'true',
          'pool': 'true',
          'created': new Date().toISOString(),
        },
      });

      // Start the container
      await container.start();

      console.log(`   Created container: ${containerName}`);
      return container;
    } catch (error) {
      console.error(`Failed to create container ${containerName}:`, error.message);
      throw error;
    }
  }

  /**
   * Ensure sandbox image exists
   */
  async ensureImage() {
    try {
      const image = docker.getImage(this.containerImage);
      await image.inspect();
      console.log(`   Image ${this.containerImage} found`);
    } catch (error) {
      try {
        // Try with tag
        const imageWithTag = docker.getImage(`${this.containerImage}:latest`);
        await imageWithTag.inspect();
        console.log(`   Image ${this.containerImage}:latest found`);
        return;
      } catch (e) {
        // Try pulling from registry
        console.log(`   Image ${this.containerImage} not found locally, attempting to pull...`);
        try {
          await docker.pull(this.containerImage);
          console.log(`   Successfully pulled ${this.containerImage}`);
          return;
        } catch (pullError) {
          console.warn(`   Could not pull image: ${pullError.message}`);
          console.log(`   Proceeding anyway - assuming image is built`);
          // Continue anyway - image might be available
        }
      }
    }
  }

  /**
   * Acquire a container from the pool
   */
  async acquire() {
    // Return immediately if available
    if (this.availableContainers.length > 0) {
      const container = this.availableContainers.pop();

      // Quick health check
      const isHealthy = await this.checkContainerHealth(container);
      if (isHealthy) {
        return container;
      } else {
        // Container is unhealthy, remove and create new one
        try {
          await this.destroyContainer(container);
        } catch (e) {
          // Ignore
        }
        // Try again
        return this.acquire();
      }
    }

    // Wait for a container to be released
    return new Promise((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }

  /**
   * Release a container back to the pool
   */
  async release(container) {
    // Check if container is still healthy
    const isHealthy = await this.checkContainerHealth(container);

    if (isHealthy) {
      // Clean up temporary files
      try {
        await this.cleanupContainer(container);
      } catch (e) {
        console.error('Cleanup error:', e.message);
      }

      // Return to pool
      const waiter = this.waitingQueue.shift();
      if (waiter) {
        waiter(container);
      } else {
        this.availableContainers.push(container);
      }
    } else {
      // Container is unhealthy, remove and create a new one
      try {
        await this.destroyContainer(container);
        const newContainer = await this.createContainer();
        this.containers.push(newContainer);
        this.release(newContainer);
      } catch (error) {
        console.error('Failed to replace unhealthy container:', error.message);
      }
    }
  }

  /**
   * Check if container is healthy
   */
  async checkContainerHealth(container) {
    try {
      const data = await container.inspect();
      return data.State.Running;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clean up temporary files in container
   */
  async cleanupContainer(container) {
    try {
      // Remove execution directory
      const exec = await container.exec({
        Cmd: ['rm', '-rf', '/tmp/execution/*'],
        AttachStdout: true,
        AttachStderr: true,
      });
      await exec.start();
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  /**
   * Destroy a container
   */
  async destroyContainer(container) {
    try {
      await container.stop({ t: 2 }); // 2 second timeout
      await container.remove({ force: true });
    } catch (error) {
      // Already stopped/removed
    }
  }

  /**
   * Health check and auto-recovery
   */
  startHealthChecks() {
    this.healthCheckInterval = setInterval(async () => {
      const unhealthyContainers = [];

      for (let i = 0; i < this.availableContainers.length; i++) {
        const container = this.availableContainers[i];
        const isHealthy = await this.checkContainerHealth(container);

        if (!isHealthy) {
          unhealthyContainers.push(i);
        }
      }

      // Remove unhealthy containers and create new ones
      for (const idx of unhealthyContainers.reverse()) {
        const container = this.availableContainers[idx];
        this.availableContainers.splice(idx, 1);

        try {
          await this.destroyContainer(container);
          const newContainer = await this.createContainer();
          this.containers.push(newContainer);
          this.availableContainers.push(newContainer);

          console.log(`🔄 Replaced unhealthy container`);
        } catch (error) {
          console.error('Failed to replace container:', error.message);
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      totalContainers: this.containers.length,
      availableContainers: this.availableContainers.length,
      busyContainers: this.containers.length - this.availableContainers.length,
      waitingQueue: this.waitingQueue.length,
    };
  }

  /**
   * Shutdown the pool
   */
  async shutdown() {
    console.log('🛑 Shutting down container pool...');

    clearInterval(this.healthCheckInterval);

    for (const container of this.containers) {
      try {
        await this.destroyContainer(container);
      } catch (error) {
        // Ignore
      }
    }

    this.containers = [];
    this.availableContainers = [];
    this.waitingQueue = [];

    console.log('✅ Container pool shut down');
  }
}

// Singleton instance
let poolInstance = null;

export async function initializePool(options = {}) {
  if (poolInstance) return poolInstance;

  poolInstance = new ContainerPool(options);
  await poolInstance.initialize();

  return poolInstance;
}

export function getPool() {
  if (!poolInstance) {
    throw new Error('Container pool not initialized');
  }
  return poolInstance;
}

export async function shutdownPool() {
  if (poolInstance) {
    await poolInstance.shutdown();
    poolInstance = null;
  }
}

export default ContainerPool;
