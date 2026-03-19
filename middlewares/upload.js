const multer = require('multer');

// Guardamos el archivo en memoria temporalmente antes de enviarlo a GCS
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

module.exports = upload;