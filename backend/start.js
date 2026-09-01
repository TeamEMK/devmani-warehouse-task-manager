// Production entry: pehle schema pakka karo, phir server uthao.
// (Hostinger jaise panels par shell nahi hota — fresh database boot par
// khud ban jaata hai. Details: data/scripts/ensure-schema.js)
const ensureSchema = require('../data/scripts/ensure-schema');

ensureSchema()
  .catch(e => console.error('schema bootstrap failed (server phir bhi start hoga):', e.message))
  .finally(() => require('./server.js'));
