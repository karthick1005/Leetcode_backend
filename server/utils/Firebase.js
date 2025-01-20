// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyD85_bw_RZqAlpXuelqKukj0Vqwq0v514s",
    authDomain: "leetcode-clone-64566.firebaseapp.com",
    projectId: "leetcode-clone-64566",
    storageBucket: "leetcode-clone-64566.firebasestorage.app",
    messagingSenderId: "851000799279",
    appId: "1:851000799279:web:103d15dc63eb0ca02b96da",
    measurementId: "G-VEQZLQVMFS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
export { db }
// const analytics = getAnalytics(app);