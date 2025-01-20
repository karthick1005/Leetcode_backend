// import { deleteFolder, execute } from "./utils";

import fs from "fs";
import { deleteFolder, execute } from "./utils.js"
import { stderr } from "process";
import prettier from "prettier";
import { exec } from "child_process";
// Inside your container script
const adminlang = "javascript"
const recievebody = process.env.MY_OBJECT;
const extensions = {
    cpp: "cpp",
    c: "c",
    java: "java",
    python: "py",
    javascript: "js",
    csharp: "cs"
};
let ans = [];
const runcommand = async (apiBody, testcase) => {
    // console.log("hello")

    await fs.promises.writeFile(`/temp/${apiBody.folder}/outputuser.txt`, "");
    // console.log("Output.txt created !");

    const commandu = `python3 run.py ../temp/${apiBody.folder}/Solution.${extensions[apiBody.lang]} ${apiBody.lang} ${apiBody.timeOut} user`;
    console.log(commandu)
    const outputu = await execute(commandu);
    await fs.promises.writeFile(`/temp/${apiBody.folder}/outputadmin.txt`, "");
    // console.log("Output.txt created !");

    const command = `python3 run.py ../temp/${apiBody.folder}/Admin.${extensions[adminlang]} ${adminlang} ${apiBody.timeOut} admin`;
    console.log(command)

    // console.log(command)
    const output = await execute(command);
    const data = await fs.promises.readFile(`/temp/${apiBody.folder}/outputuser.txt`, "utf-8");
    const dataadmin = await fs.promises.readFile(`/temp/${apiBody.folder}/outputadmin.txt`, "utf-8");
    console.log(dataadmin)
    // console.log(data)
    let result = {
        output: data.replace("\n", ""),
        input: testcase.split("\n"),
        stderr: outputu.stderr,
        status: outputu.stdout,
        submission_id: apiBody.folder,
        testcasestatus: false,
        Expected: dataadmin.replace("\n", ""),
    };
    return result;


};

// if (recievebody) {
//     try {

//         const apiBody = JSON.parse(recievebody);
//         await fs.promises.mkdir(`/temp/${apiBody.folder}`);
//         await fs.promises.writeFile(`/temp/${apiBody.folder}/Source.${extensions[apiBody.lang]}`, apiBody.src);
//         let breaked = false;
//         for (let i = 0; i < apiBody.input.length; i++) {

//             await fs.promises.writeFile(`/temp/${apiBody.folder}/input.txt`, apiBody.input[i].input);

//             const result = await runcommand(apiBody);
//             result.testcase = (result.output === apiBody.input[i].expected)
//             ans.push(result);
//             console.log(result)
//             if (result.stderr != '') {
//                 breaked = true;
//                 break;

//             }
//             if (apiBody.testcase && result.output !== apiBody.input[i].expected) {
//                 breaked = true;

//                 break;
//             }
//         }
//         await deleteFolder(`../temp/${apiBody.folder}`);// Ensure this is awaited
//         console.log('Data to returned back:', JSON.stringify({ status: breaked, data: ans }));
//     } catch (error) {
//         console.error('Error parsing JSON:', error);
//     }
// } else {
//     console.log('No object received');
// }
function processTestCases(input, numInputsPerTestCase) {
    const testCases = [];
    let index = 0;

    // Loop through the input array
    while (index < input.length) {
        const testCase = [];

        // Process based on the number of inputs required for this test case
        for (let i = 0; i < numInputsPerTestCase; i++) {
            if (index < input.length) {
                testCase.push(input[index]);
                index++;
            }
        }
        // testCase = testCase.join("\n");

        testCases.push(testCase.join("\n"));
    }

    return testCases;
}



// Function to format code based on language
async function formatCode(code, language) {
    let formattedCode;
    try {
        switch (language) {
            case "cpp":
            case "c":
                // C/C++ formatting using prettier-plugin-c
                formattedCode = await formatWithClang(code, language);
                break;
            case "java":
                // Java formatting using external tool
                formattedCode = await formatJavaWithExternalTool(code);
                break;
            case "python3":
                // Python formatting using Prettier
                formattedCode = prettier.format(code, { parser: "python" });
                break;
            case "javascript":
                // JavaScript formatting using Prettier
                formattedCode = await prettier.format(code, { parser: "babel" });
                break;
            case "csharp":
                // C# formatting using external tool
                formattedCode = await formatCSharpWithExternalTool(code);
                break;
            default:
                console.log("Unsupported language.");
                return null;
        }
        return formattedCode;
    } catch (error) {
        console.error("Error formatting code:", error);
        return null;
    }
}
async function formatWithClang(code, language) {
    return new Promise((resolve, reject) => {
        const process = exec('clang-format', (error, stdout, stderr) => {
            if (error) {
                return reject(error);
            }
            resolve(stdout); // Return formatted code
        });
        process.stdin.write(code); // Send code to the process
        process.stdin.end();
    });
}
// External tool to format Java using google-java-format
async function formatJavaWithExternalTool(code) {
    return new Promise((resolve, reject) => {
        const process = exec("google-java-format --replace -", (error, stdout, stderr) => {
            if (error) {
                return reject(error);
            }
            resolve(stdout); // Return formatted code
        });
        process.stdin.write(code); // Send code to the process
        process.stdin.end();
    });
}

// External tool to format C# using dotnet format
async function formatCSharpWithExternalTool(code) {
    return new Promise((resolve, reject) => {
        const process = exec("dotnet format", (error, stdout, stderr) => {
            if (error) {
                return reject(error);
            }
            resolve(stdout); // Return formatted code
        });
        process.stdin.write(code); // Send code to the process
        process.stdin.end();
    });
}



if (recievebody) {
    try {

        let apiBody = JSON.parse(recievebody);
        console.log("this is before admin")
        apiBody.Admin = await prettier.format(apiBody.Admin, { parser: "babel" });
        console.log("this is after admin")
        console.log(apiBody.Admin)
        // apiBody.src = apiBody.src;
        // apiBody.src = await formatCode(apiBody.src, apiBody.lang)
        console.log(apiBody.src)
        await fs.promises.mkdir(`/temp/${apiBody.folder}`);
        await fs.promises.writeFile(`/temp/${apiBody.folder}/Solution.${extensions[apiBody.lang]}`, apiBody.src);
        await fs.promises.writeFile(`/temp/${apiBody.folder}/Admin.${extensions[adminlang]}`, apiBody.Admin);

        console.log(apiBody)
        console.log("this is after api body")
        let testcase = processTestCases(apiBody.input, apiBody.Inputname.length)
        let breaked = false;
        console.log(testcase)
        let overallcase = true
        for (let i = 0; i < testcase.length; i++) {

            await fs.promises.writeFile(`/temp/${apiBody.folder}/input.txt`, testcase[i]);

            const result = await runcommand(apiBody, testcase[i]);
            result.testcasestatus = (result.output === result.Expected)
            if (!result.testcasestatus && overallcase) {
                overallcase = false
            }
            ans.push(result);
            console.log(result)
            if (result.stderr != '') {
                breaked = true;
                break;

            }
            if (apiBody.testcase && result.output !== result.Expected) {
                breaked = true;

                break;
            }
        }
        // await deleteFolder(`../temp/${apiBody.folder}`);// Ensure this is awaited
        setInterval(() => { }, 1000);
        let json = { status: breaked, data: ans, testcase: testcase, Accepted: overallcase }
        console.log('Data to returned back:', JSON.stringify(json));

    } catch (error) {
        console.error('Error parsing JSON:', error);
    }
} else {
    console.log('No object received');
}