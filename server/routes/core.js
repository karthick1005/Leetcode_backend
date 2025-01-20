import express from 'express'
import { sendMessage } from '../config/rabbitmq.js';
import { randomBytes } from 'crypto';
import { getFromRedis, errorResponse, successResponse } from '../utils.js'
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../utils/Firebase.js';

const router = express.Router();

router.post("/submit", async (req, res) => {
    try {
        let totalcode = "";
        const docsnap = await getDoc(doc(db, "problem", req.body.quesId));
        if (docsnap.exists()) {
            let value = docsnap.data();
            // console.log(value.Adminsrc)
            // value.Adminsrc = value.Adminsrc.replace(/\\r\\n/g, "\r\n") // Ensure CRLF line breaks
            //     .replace(/\\n/g, "\n")      // Convert LF line breaks (if any) to desired format
            //     .replace(/\\t/g, "\t")      // Convert escaped tabs to actual tabs
            //     .replace(/\\"/g, "\"")      // Convert escaped quotes to normal quotes
            //     .replace(/\\'/g, "'")       // Convert escaped single quotes if necessary
            //     .replace(/^\r\n' \+|'\r\n' \+|\r\n'$/gm, "");
            // for (const [key, val] of Object.entries(value.Remaining)) {
            //     // Format the value and update the dictionary

            //     value.Remaining[key] = val
            //         .replace(/\\r\\n/g, "\r\n") // Ensure CRLF line breaks
            //         .replace(/\\n/g, "\n")      // Convert LF line breaks (if any) to desired format
            //         .replace(/\\t/g, "\t")      // Convert escaped tabs to actual tabs
            //         .replace(/\\"/g, "\"")      // Convert escaped quotes to normal quotes
            //         .replace(/\\'/g, "'")       // Convert escaped single quotes if necessary
            //         .replace(/^\r\n' \+|'\r\n' \+|\r\n'$/gm, "");
            // }
            totalcode = atob(value.Remaining[req.body.lang]).replace("// INSERT_CODE_HERE", req.body.src).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
            console.log("this is total code")
            console.log(totalcode)
            let data = {
                'src': totalcode,
                'input': req.body.stdin,
                'lang': req.body.lang,
                'timeOut': value.Timeout,
                "testcase": req.body.testcase,
                "Inputname": value.Inputname,
                "Admin": value.Adminsrc,
                'folder': randomBytes(10).toString('hex')
            }
            await sendMessage(data);
            res.status(202).send(successResponse(`/results/${data.folder}`));
        }
        else {
            throw (new Error("404 Not found"))
        }
    } catch (error) {
        console.log(error);
        res.status(500).send(errorResponse(500, "System error"));
    }

});

router.get("/results/:id", async (req, res) => {

    try {
        let key = req.params.id;
        let status = await getFromRedis(key);

        if (status == null) {
            res.status(202).send({ "status": "Queued" });
        }
        else if (status == 'Processing') {
            res.status(202).send({ "status": "Processing" });
        }
        else {
            status = JSON.parse(status);
            res.status(200).send(successResponse(status));
        }
    } catch (error) {
        res.status(500).send(errorResponse(500, "System error"));
    }

});

export const coreRoutes = router;