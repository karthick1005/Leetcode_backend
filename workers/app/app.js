import fs from "fs";
import { client } from "./config/redis.js";
import { deleteFolder, execute } from "./utils.js"
import "./config/rabbitmq.js";
import Dockerode from "dockerode";

const docker = new Dockerode({
  socketPath: "/var/run/docker.sock",
});

const runCode = async (apiBody, ch, msg) => {
  let container = null;

  try {
    // Mark job as processing
    await client.set(apiBody.folder.toString(), "Processing");

    const myObjectString = JSON.stringify(apiBody);

    const containerConfig = {
      Image: "codeengine", // your execution image
      Env: [`MY_OBJECT=${myObjectString}`],
      Tty: false, // IMPORTANT: disable TTY for proper logs
      HostConfig: {
        AutoRemove: false, // keep container for debugging
      },
    };

    console.log("Creating execution container...");

    // 1️⃣ Create container
    container = await docker.createContainer(containerConfig);
    console.log("Container created:", container.id);

    // 2️⃣ Start container
    await container.start();
    console.log("Container started:", container.id);

    // 3️⃣ Wait for execution to finish
    const waitResult = await container.wait();
    console.log("Container exited with code:", waitResult.StatusCode);

    // 4️⃣ Read logs AFTER exit (CRITICAL)
    const logsBuffer = await container.logs({
      stdout: true,
      stderr: true,
    });

    const output = logsBuffer.toString();
    console.log("RAW CONTAINER OUTPUT:\n", output);

    // 5️⃣ Validate output
    if (!output || output.trim().length === 0) {
      throw new Error("Execution container produced no output");
    }

    // 6️⃣ Extract result safely
    const regex = /Data to returned back:\s*(\{[\s\S]*\})/;
    const match = regex.exec(output);

    if (!match || !match[1]) {
      console.error("Output format mismatch");
      console.error("FULL OUTPUT:", output);

      await client.setex(
        apiBody.folder.toString(),
        3600,
        JSON.stringify({
          error: "Invalid container output",
          raw: output,
        })
      );

      return;
    }

    // 7️⃣ Parse result
    const jsonData = JSON.parse(match[1]);
    console.log("Parsed execution result:", jsonData);

    await client.setex(
      apiBody.folder.toString(),
      3600,
      JSON.stringify(jsonData)
    );

  } catch (err) {
    console.error("Execution error:", err);

    await client.setex(
      apiBody.folder.toString(),
      3600,
      JSON.stringify({
        error: err.message || "Execution failed",
      })
    );

  } finally {
    // 8️⃣ Cleanup container safely
    if (container) {
      try {
        // await container.remove({ force: true });
        console.log("Container removed:", container.id);
      } catch (cleanupErr) {
        console.error("Failed to cleanup container:", cleanupErr.message);
      }
    }

    // 9️⃣ Acknowledge RabbitMQ message
    ch.ack(msg);
  }
};



export const createFiles = async (apiBody, ch, msg) => {
    try {
        // await fs.promises.mkdir(`/temp/${apiBody.folder}`);
        // await fs.promises.writeFile(`/temp/${apiBody.folder}/input.txt`, apiBody.input);
        // await fs.promises.writeFile(`/temp/${apiBody.folder}/source.${extensions[apiBody.lang]}`, apiBody.src);
        runCode(apiBody, ch, msg);
    } catch (error) {
        console.log(error)
    }
};
