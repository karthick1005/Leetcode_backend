/**
 * Connection Pool Manager
 * Reuses connections for Redis, RabbitMQ, Docker
 * Reduces overhead of creating connections per job
 */

import redis from 'redis';
import Dockerode from 'dockerode';
import * as amqp from 'amqp-connection-manager';

// ============= REDIS POOL =============
class RedisPool {
  constructor(options = {}) {
    this.connections = [];
    this.maxConnections = options.maxConnections || 10;
    this.host = options.host || 'redis-server';
    this.port = options.port || 6379;
    this.available = [];
    this.waiting = [];
  }

  async initialize() {
    // Pre-create connections
    for (let i = 0; i < Math.min(3, this.maxConnections); i++) {
      const client = redis.createClient({
        host: this.host,
        port: this.port,
      });

      await new Promise((resolve, reject) => {
        client.on('ready', resolve);
        client.on('error', reject);
      });

      this.connections.push(client);
      this.available.push(client);
    }

    console.log(`Redis pool initialized with ${this.available.length} connections`);
  }

  async acquire() {
    if (this.available.length > 0) {
      return this.available.pop();
    }

    if (this.connections.length < this.maxConnections) {
      const client = redis.createClient({
        host: this.host,
        port: this.port,
      });

      await new Promise((resolve) => {
        client.on('ready', resolve);
      });

      this.connections.push(client);
      return client;
    }

    // Wait for available connection
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(client) {
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter(client);
    } else {
      this.available.push(client);
    }
  }

  async set(key, value, options = {}) {
    const client = await this.acquire();
    try {
      return new Promise((resolve, reject) => {
        if (options.ttl) {
          client.setex(key, options.ttl, value, (err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
        } else {
          client.set(key, value, (err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
        }
      });
    } finally {
      this.release(client);
    }
  }

  async get(key) {
    const client = await this.acquire();
    try {
      return new Promise((resolve, reject) => {
        client.get(key, (err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
    } finally {
      this.release(client);
    }
  }

  close() {
    this.connections.forEach((client) => client.quit());
    this.connections = [];
    this.available = [];
    this.waiting = [];
    console.log('Redis pool closed');
  }
}

// ============= RABBITMQ POOL =============
class RabbitMQPool {
  constructor(options = {}) {
    this.url = options.url || 'amqp://rabbitmq:5672';
    this.queueName = options.queueName || 'judge';
    this.channelWrapper = null;
    this.connection = null;
  }

  async initialize() {
    this.connection = amqp.connect([this.url]);

    this.connection.on('connect', () => {
      console.log('RabbitMQ connected');
    });

    this.connection.on('disconnect', (err) => {
      console.error('RabbitMQ disconnected:', err);
    });

    this.channelWrapper = this.connection.createChannel({
      json: true,
      setup: async (channel) => {
        await channel.assertQueue(this.queueName, { durable: true });
      },
    });

    console.log('RabbitMQ pool initialized');
  }

  async sendMessage(data) {
    return this.channelWrapper.sendToQueue(this.queueName, data);
  }

  async consume(handler) {
    // Consume messages with prefetch
    const channelWrapper = this.connection.createChannel({
      setup: async (channel) => {
        await channel.prefetch(2); // Process 2 messages at a time
        await channel.assertQueue(this.queueName, { durable: true });
        await channel.consume(this.queueName, handler);
      },
    });

    return channelWrapper;
  }

  close() {
    if (this.connection) {
      this.connection.close();
    }
    console.log('RabbitMQ pool closed');
  }
}

// ============= DOCKER POOL =============
class DockerPool {
  constructor(options = {}) {
    this.socketPath = options.socketPath || '/var/run/docker.sock';
    this.docker = null;
  }

  initialize() {
    this.docker = new Dockerode({
      socketPath: this.socketPath,
    });
    console.log('Docker pool initialized');
  }

  getDocker() {
    return this.docker;
  }

  close() {
    // Docker doesn't need explicit close
    console.log('Docker pool closed');
  }
}

// ============= SINGLETON INSTANCES =============
let redisPool = null;
let rabbitmqPool = null;
let dockerPool = null;

export async function initializePools() {
  redisPool = new RedisPool();
  await redisPool.initialize();

  rabbitmqPool = new RabbitMQPool();
  await rabbitmqPool.initialize();

  dockerPool = new DockerPool();
  dockerPool.initialize();

  console.log('All connection pools initialized');
}

export function getRedisPool() {
  if (!redisPool) throw new Error('Redis pool not initialized');
  return redisPool;
}

export function getRabbitMQPool() {
  if (!rabbitmqPool) throw new Error('RabbitMQ pool not initialized');
  return rabbitmqPool;
}

export function getDockerPool() {
  if (!dockerPool) throw new Error('Docker pool not initialized');
  return dockerPool;
}

export async function closePools() {
  if (redisPool) redisPool.close();
  if (rabbitmqPool) rabbitmqPool.close();
  if (dockerPool) dockerPool.close();
  console.log('All pools closed');
}
