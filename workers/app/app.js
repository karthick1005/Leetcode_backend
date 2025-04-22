import fs from "fs";
import { client } from "./config/redis.js";
import { deleteFolder, execute } from "./utils.js"
import "./config/rabbitmq.js";
import Dockerode from "dockerode";

const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
const extensions = {
    cpp: "cpp",
    c: "c",
    java: "java",
    python3: "txt",
};

const runCode = async (apiBody, ch, msg) => {
    try {
        client.set(apiBody.folder.toString(), 'Processing');
        const myObjectString = JSON.stringify(apiBody);
        const containerConfig = {
            Image: 'codeengine', // Replace with your Docker image name
            Env: [`MY_OBJECT=${myObjectString}`], // Pass the object as an environment variable
            Tty: true, // Enable TTY if needed
            HostConfig: {

                AutoRemove: true,
            },
        };
        console.log("hello")
        // docker.createContainer(containerConfig)
        //     .then(container => {
        //         console.log('Container created:', container.id);

        //         // Start the container
        //         return container.start();
        //     })
        //     .then(container => {
        //         console.log('Container started:', container.id);
        //     })
        //     .catch(err => {
        //         console.error('Error:', err);
        //     });

        docker.createContainer(containerConfig)
            .then(container => {
                console.log('Container created:', container.id);
                return container.start()
                    .then(() => {
                        console.log('Container started:', container.id);
                        // Wait for the container to finish
                        return container.wait();
                    })
                    .then(() => {
                        // Capture the container logs
                        return new Promise((resolve, reject) => {
                            let output = '';
                            container.logs({
                                follow: true,
                                stdout: true,
                                stderr: true
                            }, (err, stream) => {
                                if (err) return reject(err);
                                stream.on('data', (chunk) => {
                                    output += chunk.toString();
                                });
                                stream.on('end', () => {
                                    resolve(output);
                                });
                            });
                        });
                    });
            })
            .then((output) => {
                // Parse the output to extract the desired data
                const regex = /Data to returned back:\s*(\{[\s\S]*\})/; // Adjust the regex based on your output
                const match = regex.exec(output);
                console.log(match[1])
                console.log("this is after")
                if (match && match[1]) {
                    let jsonData = match[1];
                    // jsonData = jsonData
                    //     .replace(/(\w+):/g, '"$1":')              // Wrap keys with double quotes
                    //     .replace(/'/g, '"')                       // Replace single quotes with double quotes
                    //     .replace(/,\s*}/g, '}')                   // Remove trailing commas before closing brace
                    //     .replace(/,\s*]/g, ']');
                    // jsonData = jsonData.replace(/\u001b\[\d+m/g, '')       // Remove ANSI escape codes
                    //     .replace(/(\w+):/g, '"$1":')        // Wrap keys with double quotes
                    //     .replace(/,\s*}/g, '}')              // Remove trailing commas before closing brace
                    //     .replace(/,\s*]/g, ']')
                    //     .replace(/:\s*(".*?")/g, ': $1') // Ensure proper spacing after colons
                    //     .replace(/(\w+):/g, '"$1":')
                    console.log(jsonData)
                    jsonData = JSON.parse(jsonData)
                    console.log('Data received from container:', jsonData);
                    client.setex(apiBody.folder.toString(), 3600, JSON.stringify(jsonData));
                } else {
                    console.error('No data found in output.');
                    client.setex(apiBody.folder.toString(), 3600, JSON.stringify({ error: "No data founds" }));
                    // res.status(500).json({ error: 'No data found in container output.' });
                }
            })
            .catch(err => {
                console.error('Error:', err);
                client.setex(apiBody.folder.toString(), 3600, JSON.stringify({ error: err }));

                // res.status(500).json({ error: 'Failed to run container.' });
            });
        // const command = `python3 run.py ../temp/${apiBody.folder}/source.${extensions[apiBody.lang]} ${apiBody.lang} ${apiBody.timeOut}`;
        // await fs.promises.writeFile(`/temp/${apiBody.folder}/output.txt`, "");
        // console.log("Output.txt created !")

        // const output = await execute(command);
        // const data = await fs.promises.readFile(`/temp/${apiBody.folder}/output.txt`, "utf-8");
        // let result = {
        //     output: data,
        //     stderr: output.stderr,
        //     status: output.stdout,
        //     submission_id: apiBody.folder,
        // };

        // console.log(result);
        // deleteFolder(`../temp/${apiBody.folder}`);

        ch.ack(msg);
    } catch (error) {
        console.log("Error")
    }

}

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
