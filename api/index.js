// Vercel serverless entrypoint.
//
// Vercel `api/` folder ki har file ko ek serverless function maanta hai. Yahan
// hum poori Express app ko hi handler ki tarah export kar dete hain, aur
// vercel.json har request ko isi par bhej deta hai — isliye routing, static
// files aur middleware sab pehle jaise chalte rehte hain.
//
// server.js khud dekh leta hai ki wo serverless par hai (process.env.VERCEL)
// aur tab app.listen() nahi karta.
module.exports = require('../backend/server.js');
