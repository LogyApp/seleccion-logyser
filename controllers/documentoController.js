const db = require('../config/db');
const path = require('path');
const { Storage } = require('@google-cloud/storage');

const { getBucketAspirantes } = require('../config/gcs');

// ESTA ES LA FUNCIÓN QUE PROCESA UNO POR UNO
async function guardarArchivo(id_aspirante, id_config_doc, file) {
    // 1. Obtener datos para el nombre del archivo (identificación y prefijo)
    const [datos] = await db.query(
        'SELECT a.identificacion, c.Prefijo FROM Dynamic_hv_aspirante a JOIN Config_Doc_Trabajador c ON c.Id = ? WHERE a.id_aspirante = ?',
        [id_config_doc, id_aspirante]
    );

    if (datos.length === 0) throw new Error('Datos no encontrados para el aspirante o documento');

    const { identificacion, Prefijo } = datos[0];
    const extension = path.extname(file.originalname);
    
    // Nombre del archivo: identificacion.PREFIJO.uuid.pdf
    const nombreArchivo = `${identificacion}.${Prefijo}.${id_aspirante}${extension}`;
    
    // CAMBIO AQUÍ: La subcarpeta ahora es la identificación
    const gcsPath = `${identificacion}/${nombreArchivo}`; 

    // 2. Subir a Google Cloud Storage
    const bucket = getBucketAspirantes();
    const blob = bucket.file(gcsPath);
    const blobStream = blob.createWriteStream({ resumable: false });

    return new Promise((resolve, reject) => {
        blobStream.on('error', (err) => reject(err));
        blobStream.on('finish', async () => {
            // 3. Registrar en la base de datos con la nueva ruta
            await db.query(
            'INSERT INTO Dynamic_hv_documentos (id_aspirante, id_config_doc, gcs_path, estado) ' +
            'VALUES (?, ?, ?, ?) ' +
            'ON DUPLICATE KEY UPDATE gcs_path = VALUES(gcs_path), estado = VALUES(estado), fecha_actualizacion = CURRENT_TIMESTAMP',
            [id_aspirante, id_config_doc, gcsPath, 'Pendiente']
            );
            resolve(nombreArchivo);
        });
        blobStream.end(file.buffer);
    });
}

// Esta es la que ya tenías (por si la usas desde otro lado)
exports.uploadDocumento = async (req, res) => {
    try {
        await guardarArchivo(req.body.id_aspirante, req.body.id_config_doc, req.file);
        res.send(`<script>alert('Cargado'); window.location.href='/portal/${req.body.id_aspirante}';</script>`);
    } catch (error) {
        res.status(500).send(error.message);
    }
};

// EXPORTAMOS LA NUEVA FUNCIÓN PARA EL BUCLE
exports.guardarArchivo = guardarArchivo;