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
    let std = data.split("\n").splice(0, data.split("\n").length - 1);
    let result = {
        output: std.at(-1) || null,
        stdout: std.splice(0, std.length - 1).slice(0, 8333),
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
        let startTime = performance.now();
        let endTime = performance.now();
        let error = false
        for (let i = 0; i < testcase.length; i++) {

            await fs.promises.writeFile(`/temp/${apiBody.folder}/input.txt`, testcase[i]);
            startTime = Math.max(endTime, performance.now());
            const result = await runcommand(apiBody, testcase[i]);
            result.testcasestatus = (result.output === result.Expected)
            if (!result.testcasestatus && overallcase) {
                overallcase = false
            }
            ans.push(result);
            console.log(result)
            endTime = Math.max(endTime, performance.now());
            if (result.stderr != '') {
                breaked = true;
                error = "Runtime Error"
                break;

            }
            else if (result.status === "timeout\n") {
                breaked = true;
                error = "TImelimit Exceeded"
                break;
            }
            if (apiBody.testcase && result.output !== result.Expected) {
                breaked = true;

                break;
            }
        }

        // await deleteFolder(`../temp/${apiBody.folder}`);// Ensure this is awaited
        // setInterval(() => { }, 1000);
        let json = { status: breaked, data: ans, testcase: testcase, Accepted: overallcase, runtime: endTime - startTime, error }
        console.log(json)
        console.log('Data to returned back:', JSON.stringify(json));

    } catch (error) {
        console.error('Error parsing JSON:', error);
    }
} else {
    console.log('No object received');
}