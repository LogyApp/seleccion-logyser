const express = require('express');
const path = require('path');
const upload = require('./middlewares/upload');
const documentoController = require('./controllers/documentoController');
const db = require('./config/db');
const { getBucketAspirantes, getBucketEmpleados } = require('./config/gcs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function jsonOk(res, { message = 'OK', redirect = null, data = null } = {}) {
  return res.status(200).json({ ok: true, message, redirect, data });
}

function jsonError(res, error, { status = 500, message = 'Error interno' } = {}) {
  const details = error?.message ? String(error.message) : String(error);
  return res.status(status).json({ ok: false, message, details });
}

// --- 1. RUTA DEL ASPIRANTE (/portal/:uuid) ---
app.get('/portal/:uuid', async (req, res) => {
    const { uuid } = req.params;
    const docsAspirante = [
        { id: 11, nombre: "Copia de la cédula ampliada al 150%" },
        { id: 5,  nombre: "Antecedentes (Policía, Procuraduría, Contraloría)" },
        { id: 15, nombre: "Certificado de EPS" },
        { id: 3,  nombre: "ADRES (Si no tiene EPS)" },
        { id: 14, nombre: "Certificado de Pensión" },
        { id: 13, nombre: "Certificado de Estudio" },
        { id: 17, nombre: "Certificado Laboral" },
        { id: 10, nombre: "Certificación Bancaria" }
    ];

    try {
        const [aspirante] = await db.query(
        'SELECT primer_nombre, pdf_public_url FROM Dynamic_hv_aspirante WHERE id_aspirante = ?',
        [uuid]
        );
        const nombre = aspirante.length > 0 ? aspirante[0].primer_nombre : 'Aspirante';
        const pdfUrl = aspirante.length > 0 ? (aspirante[0].pdf_public_url || '').trim() : '';

        const [cargados] = await db.query('SELECT id_config_doc, estado, gcs_path FROM Dynamic_hv_documentos WHERE id_aspirante = ?', [uuid]);
        
        const mapaDocs = {};
        cargados.forEach(c => {
            mapaDocs[c.id_config_doc] = { estado: c.estado, path: c.gcs_path };
        });

        res.send(generarHtmlPortal(uuid, nombre, docsAspirante, mapaDocs, pdfUrl));
    } catch (error) {
        console.error(error);
        res.status(500).send("Error al cargar el portal");
    }
});

// --- 1. RUTA DEL ADMIN
app.get('/admin/:uuid', async (req, res) => {
    const { uuid } = req.params;
    const nombresAsp = {
        11: "Cédula 150%", 5: "Antecedentes", 15: "EPS", 3: "ADRES", 
        14: "Pensión", 13: "Estudio", 17: "Cert. Laboral", 10: "Bancaria"
    };
    const docsAspiranteIds = [11, 5, 15, 3, 14, 13, 17, 10];
    const docsTecnicos = [
        { id: 24, nombre: "Examen médico" }, { id: 28, nombre: "Estudio seguridad" },
        { id: 27, nombre: "Entrevista" }, { id: 8, nombre: "Manipulación alimentos" },
        { id: 53, nombre: "Verificación referencias" }
    ];
    const docsFirmar = [
        { id: 2, nombre: "Acta condiciones" },
        { id: 7, nombre: "Análisis riesgo" }, { id: 16, nombre: "Consentimiento H. Clínica" },
        { id: 19, nombre: "Consentimiento Prueba" }, { id: 20, nombre: "Condiciones salud" },
        { id: 29, nombre: "Evaluación Inducción" }, { id: 32, nombre: "Comprobante Inducción" },
        { id: 39, nombre: "Manual funciones" }, { id: 48, nombre: "Normas seguridad" },
        { id: 49, nombre: "Tratamiento datos" }, { id: 33, nombre: "Formatos Italcol" }
    ];

    try {
        const [aspirantes] = await db.query(
            `SELECT primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, 
                    identificacion, estado_proceso, IdRequisicion, pdf_public_url
            FROM Dynamic_hv_aspirante WHERE id_aspirante = ?`, [uuid]
        );

        if (aspirantes.length === 0) return res.send("Aspirante no encontrado");
        
        const a = aspirantes[0];

        const pdfUrl = (a.pdf_public_url || '').trim();

        let requisicionInfo = '';
        let regionalSugerida = '';
        let operacionSugerida = '';

        if (a.IdRequisicion) {
        const [reqRows] = await db.query(
            'SELECT `Requisición`, `Operación`, `Cargo Requerido`, `Fecha Requisición`, `Regional` FROM Dynamic_Requisiciones WHERE IdRequisicion = ? LIMIT 1',
            [a.IdRequisicion]
        );

        if (reqRows.length > 0) {
            const r = reqRows[0];

            // Prefill modal
            regionalSugerida = (r['Regional'] || '').toString().trim();
            operacionSugerida = (r['Operación'] || '').toString().trim();

            // Texto bonito en pantalla
            const meses = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const dias = ['dom','lun','mar','mie','jue','vie','sab'];

            const formatearFechaReq = (v) => {
            if (!v) return '';
            const d = v instanceof Date ? v : new Date(v);
            if (isNaN(d.getTime())) return String(v).trim();
            const ddd = dias[d.getDay()];
            const dd = String(d.getDate()).padStart(2, '0');
            const mmm = meses[d.getMonth()];
            const yyyy = d.getFullYear();
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return `${ddd} ${dd} ${mmm} ${yyyy} ${hh}:${mm}:${ss}`;
            };

            const req = (r['Requisición'] || '').toString().trim();
            const ope = (r['Operación'] || '').toString().trim();
            const car = (r['Cargo Requerido'] || '').toString().trim();
            const fec = formatearFechaReq(r['Fecha Requisición']);

            requisicionInfo = [req, ope, car, fec].filter(x => x).join(' | ');
        }
        }

        // --- AQUÍ ESTABA EL ERROR: DEFINIMOS LA VARIABLE ---
        const nombreCompleto = [a.primer_nombre, a.segundo_nombre, a.primer_apellido, a.segundo_apellido]
            .filter(n => n && n.trim() !== "")
            .join(" ");

        const estaContratado = a.estado_proceso === 'contratado';
        const [cargados] = await db.query('SELECT id_config_doc, estado, gcs_path FROM Dynamic_hv_documentos WHERE id_aspirante = ?', [uuid]);
        const mapaDocs = {};
        cargados.forEach(c => { mapaDocs[c.id_config_doc] = { estado: c.estado, path: c.gcs_path }; });

        // Enviamos el objeto con nombreCompleto e IdRequisicion
        res.send(generarHtmlAdmin(
        uuid,
        {
            nombreCompleto,
            identificacion: a.identificacion,
            IdRequisicion: a.IdRequisicion,
            pdfUrl,
            requisicionInfo,
            regionalSugerida,
            operacionSugerida
        },
        docsAspiranteIds, nombresAsp, docsTecnicos, docsFirmar, mapaDocs, estaContratado
        ));

    } catch (error) {
        console.error(error);
        res.status(500).send("Error en panel administrativo");
    }
});

app.post('/aprobar-doc', async (req, res) => {
  const { id_aspirante, id_config_doc } = req.body;

  try {
    await db.query(
      'UPDATE Dynamic_hv_documentos SET estado = "Aprobado" WHERE id_aspirante = ? AND id_config_doc = ?',
      [id_aspirante, id_config_doc]
    );

    return jsonOk(res, { message: 'Documento aprobado', redirect: `/admin/${id_aspirante}` });
  } catch (error) {
    return jsonError(res, error, { message: 'Error al aprobar documento' });
  }
});

app.post('/aprobar-masivo', async (req, res) => {
  const { id_aspirante, ids_docs } = req.body;

  try {
    const ids = Array.isArray(ids_docs) ? ids_docs : JSON.parse(ids_docs);

    await db.query(
      'UPDATE Dynamic_hv_documentos SET estado = "Aprobado" WHERE id_aspirante = ? AND id_config_doc IN (?)',
      [id_aspirante, ids]
    );

    return jsonOk(res, { message: 'Aprobación masiva completada', redirect: `/admin/${id_aspirante}` });
  } catch (error) {
    return jsonError(res, error, { message: 'Error en aprobación masiva' });
  }
});

// --- 2. RUTA PARA ELIMINAR DOCUMENTOS ---
app.post('/delete-doc', async (req, res) => {
  const { id_aspirante, id_config_doc } = req.body;

  try {
    const [rows] = await db.query(
      'SELECT gcs_path FROM Dynamic_hv_documentos WHERE id_aspirante = ? AND id_config_doc = ?',
      [id_aspirante, id_config_doc]
    );

    if (rows.length === 0) {
      return jsonError(res, new Error('No encontrado'), { status: 404, message: 'Documento no encontrado' });
    }

    const filePath = rows[0].gcs_path;
    await getBucketAspirantes().file(filePath).delete().catch(() => {});
    await db.query(
      'DELETE FROM Dynamic_hv_documentos WHERE id_aspirante = ? AND id_config_doc = ?',
      [id_aspirante, id_config_doc]
    );

    return jsonOk(res, { message: 'Documento eliminado', redirect: `/portal/${id_aspirante}` });
  } catch (error) {
    return jsonError(res, error, { message: 'Error al eliminar documento' });
  }
});

app.post('/delete-doc-admin', async (req, res) => {
  const { id_aspirante, id_config_doc } = req.body;

  try {
    const [rows] = await db.query(
      'SELECT gcs_path FROM Dynamic_hv_documentos WHERE id_aspirante = ? AND id_config_doc = ?',
      [id_aspirante, id_config_doc]
    );

    if (rows.length === 0) {
      return jsonError(res, new Error('No encontrado'), { status: 404, message: 'Documento no encontrado' });
    }

    const filePath = rows[0].gcs_path;
    await getBucketAspirantes().file(filePath).delete().catch(() => {});
    await db.query(
      'DELETE FROM Dynamic_hv_documentos WHERE id_aspirante = ? AND id_config_doc = ?',
      [id_aspirante, id_config_doc]
    );

    return jsonOk(res, { message: 'Documento eliminado', redirect: `/admin/${id_aspirante}` });
  } catch (error) {
    return jsonError(res, error, { message: 'Error al eliminar documento (admin)' });
  }
});
// --- 3. RUTA DE CARGA MÚLTIPLE ---
app.post('/upload-multiple', upload.any(), async (req, res) => {
  const { id_aspirante, origen } = req.body;
  const archivos = req.files;

  if (!archivos || archivos.length === 0) {
    return jsonError(res, new Error('Sin archivos'), { status: 400, message: 'No seleccionaste archivos' });
  }

  try {
    for (const file of archivos) {
      const id_config_doc = Number(String(file.fieldname).replace('file_', ''));
      await documentoController.guardarArchivo(id_aspirante, id_config_doc, file);
    }

    const redirectPath = origen === 'admin' ? `/admin/${id_aspirante}` : `/portal/${id_aspirante}`;
    return jsonOk(res, { message: 'Documentos cargados con éxito', redirect: redirectPath });
  } catch (error) {
    return jsonError(res, error, { message: 'Error al cargar archivos' });
  }
});

// Obtener regionales únicas (excluyendo INACTIVO)
app.get('/api/regionales', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT DISTINCT REGIONAL FROM Maestro_Operaciones WHERE REGIONAL != "INACTIVO" ORDER BY REGIONAL ASC');
        res.json(rows.map(r => r.REGIONAL));
    } catch (error) { res.status(500).json([]); }
});

// Obtener operaciones por regional
app.get('/api/operaciones/:regional', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT OPERACIÓN FROM Maestro_Operaciones WHERE REGIONAL = ? ORDER BY OPERACIÓN ASC', [req.params.regional]);
        res.json(rows.map(r => r.OPERACIÓN));
    } catch (error) { res.status(500).json([]); }
});

app.post('/finalizar-contratacion', async (req, res) => {
    // 1. Recibimos también 'regional' desde el modal
    const { id_aspirante, regional, operacion, fecha_ingreso } = req.body;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Obtener info completa del aspirante (AQUÍ DEFINIMOS 'a')
        const [asp] = await connection.query('SELECT * FROM Dynamic_hv_aspirante WHERE id_aspirante = ?', [id_aspirante]);
        if (asp.length === 0) throw new Error("Aspirante no encontrado");
        const a = asp[0]; // <--- Ahora 'a' ya existe para el resto del código

        // 1) Educación más reciente (Grado Escolaridad.ms)
        const [eduRows] = await connection.query(
        'SELECT nivel_escolaridad FROM Dynamic_hv_educacion WHERE id_aspirante = ? AND ano IS NOT NULL ORDER BY ano DESC LIMIT 1',
        [id_aspirante]
        );
        const gradoEscolaridad = eduRows.length > 0 ? eduRows[0].nivel_escolaridad : null;

        // 2) Contacto emergencia (Nombre/Telefono.ms)
        const [emeRows] = await connection.query(
        'SELECT nombre_completo, telefono FROM Dynamic_hv_contacto_emergencia WHERE id_aspirante = ? LIMIT 1',
        [id_aspirante]
        );
        const nombreEmergencia = emeRows.length > 0 ? emeRows[0].nombre_completo : null;
        const telefonoEmergencia = emeRows.length > 0 ? emeRows[0].telefono : null;

        // 3) Requisición (Cargo.mv)
        const [reqRows] = await connection.query(
        'SELECT `Cargo Requerido` FROM Dynamic_Requisiciones WHERE IdRequisicion = ? LIMIT 1',
        [a.IdRequisicion]
        );
        const cargoRequerido = reqRows.length > 0 ? reqRows[0]['Cargo Requerido'] : null;

        // 2. Lógica de mensaje de Reingreso
        const [existeEnSocio] = await connection.query('SELECT Identificación FROM Maestro_Segmentación WHERE Identificación = ?', [a.identificacion]);
        const esReingreso = existeEnSocio.length > 0;
        const mensajeFinal = esReingreso 
            ? 'El aspirante ya se encuentra en la Sociodemográfica, se reorganizarán los datos' 
            : 'Información enviada con éxito a la Sociodemográfica';

        // 3. Zona Horaria Bogotá (-5) en SQL
        // Reemplaza NOW() por CONVERT_TZ(NOW(),'SYSTEM','-05:00') en tus consultas
        const horaBogota = "CONVERT_TZ(NOW(),'SYSTEM','-05:00')";

        // VALIDACIÓN: IdRequisicion obligatorio
        if (!a.IdRequisicion) {
            throw new Error("Es necesario que la hoja de vida esté vinculado a una requisición");
        }

        // 3. BUSCAR DATOS COMPLEMENTARIOS (Siesa y Tipo Identificación)
        // Buscamos Cod Siesa en Maestro_Operaciones
        const [opData] = await connection.query(
            'SELECT `CODIGO CO SIESA` FROM Maestro_Operaciones WHERE OPERACIÓN = ?', 
            [operacion]
        );
        const codSiesa = opData.length > 0 ? opData[0]['CODIGO CO SIESA'] : null;

        // Buscamos el Cod Identificación en la tabla correcta: Config_Tipo_Identificación
        const [tipoDocResult] = await connection.query(
            'SELECT `Cod Identificación` FROM Config_Tipo_Identificación WHERE Descripción = ?', 
            [a.tipo_documento]
        );
        const codTipoDoc = tipoDocResult.length > 0 ? tipoDocResult[0]['Cod Identificación'] : 'CC';

        // 4. Formatear Nombre: identificacion ** NOMBRE COMPLETO
        const nombreTrabajador = `${a.identificacion} ** ${[a.primer_nombre, a.segundo_nombre, a.primer_apellido, a.segundo_apellido]
            .filter(n => n && n.trim() !== "").join(" ").toUpperCase()}`.replace(/\s+/g, ' ');

        // 5. TABLA: Maestro_Segmentación (UPSERT) - AJUSTADO A NUEVO ESQUEMA + MAPEO hv -> ms

        const identificacionInt = Number(a.identificacion);
        if (!Number.isFinite(identificacionInt)) {
        throw new Error(`Identificación inválida: ${a.identificacion}`);
        }

        // Trabajador.ms = "identificacion ** NOMBRE COMPLETO" (mayúsculas, sin dobles espacios, omite vacíos)
        const nombreCompletoUpper = [
        a.primer_nombre,
        a.segundo_nombre,
        a.primer_apellido,
        a.segundo_apellido
        ]
        .map(x => (x || '').toString().trim())
        .filter(x => x.length > 0)
        .join(' ')
        .toUpperCase()
        .replace(/\s+/g, ' ');

        const trabajadorMs = `${a.identificacion} ** ${nombreCompletoUpper}`.replace(/\s+/g, ' ').trim();

        const sqlSegmentacion = `
        INSERT INTO Maestro_Segmentación (
            \`Identificación\`,
            \`Condicion\`,
            \`Trabajador\`,
            \`Tipo de Documento\`,
            \`Cod. Tipo Doc\`,
            \`Primer Nombre\`,
            \`Segundo Nombre\`,
            \`Primer Apellido\`,
            \`Segundo Apellido\`,
            \`Género\`,
            \`RH\`,
            \`País Expedición\`,
            \`Departamento Expedición\`,
            \`Ciudad Expedición\`,
            \`Fecha Expedición\`,
            \`País Nacimiento\`,
            \`Departamento Nacimiento\`,
            \`Ciudad Nacimiento\`,
            \`Fecha Nacimiento\`,
            \`Pais Residencia\`,
            \`Departamento Residencia\`,
            \`Ciudad de Residencia\`,
            \`Dirección de Residencia\`,
            \`Celular\`,
            \`Email\`,
            \`Estado Civil\`,
            \`Grado Escolaridad\`,
            \`EPS\`,
            \`Radicacion EPS\`,
            \`Tipo afiliado\`,
            \`Pensión\`,
            \`Radicacion AFP\`,
            \`Cesantías\`,
            \`Caja de Compensación\`,
            \`Radicacion CCF\`,
            \`ARL\`,
            \`Riesgo ARL\`,
            \`Nombre Contacto de Emergencia\`,
            \`Telefono Contacto de Emergencia\`,
            \`Banco\`,
            \`N° Cuenta Bancaria\`,
            \`Chaqueta\`,
            \`Camiseta\`,
            \`Numero\`,
            \`Pantalon\`,
            \`Botas\`,
            \`Fecha_Ultima_Entrega\`,
            \`Observaciones dotacion\`,
            \`Estado\`,
            \`Centro de costos\`,
            \`Operación\`,
            \`Usuario\`,
            \`Fecha de Actualización\`
        )
        VALUES (
            ?,  -- Identificación
            ?,  -- Condicion
            ?,  -- Trabajador
            ?,  -- Tipo de Documento
            ?,  -- Cod. Tipo Doc
            ?,  -- Primer Nombre
            ?,  -- Segundo Nombre
            ?,  -- Primer Apellido
            ?,  -- Segundo Apellido
            ?,  -- Género
            ?,  -- RH
            ?,  -- País Expedición
            ?,  -- Departamento Expedición
            ?,  -- Ciudad Expedición
            ?,  -- Fecha Expedición
            ?,  -- País Nacimiento
            ?,  -- Departamento Nacimiento
            ?,  -- Ciudad Nacimiento
            ?,  -- Fecha Nacimiento
            ?,  -- Pais Residencia
            ?,  -- Departamento Residencia
            ?,  -- Ciudad de Residencia
            ?,  -- Dirección de Residencia
            ?,  -- Celular
            ?,  -- Email
            ?,  -- Estado Civil
            ?,  -- Grado Escolaridad
            ?,  -- EPS
            ?,  -- Radicacion EPS
            ?,  -- Tipo afiliado
            ?,  -- Pensión
            ?,  -- Radicacion AFP
            ?,  -- Cesantías
            ?,  -- Caja de Compensación
            ?,  -- Radicacion CCF
            ?,  -- ARL
            ?,  -- Riesgo ARL
            ?,  -- Nombre Contacto de Emergencia
            ?,  -- Telefono Contacto de Emergencia
            ?,  -- Banco
            ?,  -- N° Cuenta Bancaria
            ?,  -- Chaqueta
            ?,  -- Camiseta
            ?,  -- Numero
            ?,  -- Pantalon
            ?,  -- Botas
            ?,  -- Fecha_Ultima_Entrega
            ?,  -- Observaciones dotacion
            ?,  -- Estado
            ?,  -- Centro de costos
            ?,  -- Operación
            ?,  -- Usuario
            ${horaBogota} -- Fecha de Actualización
        )
        ON DUPLICATE KEY UPDATE
            \`Condicion\` = VALUES(\`Condicion\`),
            \`Trabajador\` = VALUES(\`Trabajador\`),
            \`Tipo de Documento\` = VALUES(\`Tipo de Documento\`),
            \`Cod. Tipo Doc\` = VALUES(\`Cod. Tipo Doc\`),
            \`Primer Nombre\` = VALUES(\`Primer Nombre\`),
            \`Segundo Nombre\` = VALUES(\`Segundo Nombre\`),
            \`Primer Apellido\` = VALUES(\`Primer Apellido\`),
            \`Segundo Apellido\` = VALUES(\`Segundo Apellido\`),
            \`RH\` = VALUES(\`RH\`),
            \`País Expedición\` = VALUES(\`País Expedición\`),
            \`Departamento Expedición\` = VALUES(\`Departamento Expedición\`),
            \`Ciudad Expedición\` = VALUES(\`Ciudad Expedición\`),
            \`Fecha Expedición\` = VALUES(\`Fecha Expedición\`),
            \`Fecha Nacimiento\` = VALUES(\`Fecha Nacimiento\`),
            \`Pais Residencia\` = VALUES(\`Pais Residencia\`),
            \`Departamento Residencia\` = VALUES(\`Departamento Residencia\`),
            \`Ciudad de Residencia\` = VALUES(\`Ciudad de Residencia\`),
            \`Dirección de Residencia\` = VALUES(\`Dirección de Residencia\`),
            \`Celular\` = VALUES(\`Celular\`),
            \`Email\` = VALUES(\`Email\`),
            \`Estado Civil\` = VALUES(\`Estado Civil\`),
            \`Grado Escolaridad\` = VALUES(\`Grado Escolaridad\`),
            \`EPS\` = VALUES(\`EPS\`),
            \`Pensión\` = VALUES(\`Pensión\`),
            \`Chaqueta\` = VALUES(\`Chaqueta\`),
            \`Camiseta\` = VALUES(\`Camiseta\`),
            \`Pantalon\` = VALUES(\`Pantalon\`),
            \`Botas\` = VALUES(\`Botas\`),
            \`ARL\` = VALUES(\`ARL\`),
            \`Centro de costos\` = VALUES(\`Centro de costos\`),
            \`Operación\` = VALUES(\`Operación\`),
            \`Usuario\` = VALUES(\`Usuario\`),
            \`Estado\` = VALUES(\`Estado\`),
            \`Fecha de Actualización\` = ${horaBogota}
        `;

        const paramsSegmentacionNuevo = [
        // Identificación.ms
        identificacionInt,

        // Condicion.ms
        null,

        // Trabajador.ms
        trabajadorMs,

        // Tipo de Documento.ms
        a.tipo_documento || null,

        // Cod. Tipo Doc.ms (Config_Tipo_Documento)
        codTipoDoc || null,

        // Nombres.ms
        a.primer_nombre?.toString().trim().toUpperCase() || null,
        a.segundo_nombre?.toString().trim().toUpperCase() || null,
        a.primer_apellido?.toString().trim().toUpperCase() || null,
        a.segundo_apellido?.toString().trim().toUpperCase() || null,

        // Género.ms
        null,

        // RH.ms
        a.rh || null,

        // País Expedición.ms
        'Colombia',

        // Departamento/Ciudad/Fecha Expedición.ms
        a.departamento_expedicion || null,
        a.ciudad_expedicion || null,
        a.fecha_expedicion || null,

        // País/Departamento/Ciudad Nacimiento.ms
        null,
        null,
        null,

        // Fecha Nacimiento.ms
        a.fecha_nacimiento || null,

        // Pais Residencia.ms
        'Colombia',

        // Departamento/Ciudad/Dirección Residencia.ms
        a.departamento || null,
        a.ciudad || null,
        a.direccion_barrio || null,

        // Celular / Email / Estado Civil.ms
        a.telefono || null,
        a.correo_electronico || null,
        a.estado_civil || null,

        // Grado Escolaridad.ms
        gradoEscolaridad,

        // EPS.ms
        a.eps || null,

        // Radicacion EPS.ms
        null,

        // Tipo afiliado.ms
        null,

        // Pensión.ms = afp.hv (según tu mapeo)
        a.afp || null,

        // Radicacion AFP.ms
        null,

        // Cesantías.ms
        null,

        // Caja de Compensación.ms
        null,

        // Radicacion CCF.ms
        null,

        // ARL.ms
        'Bolivar',

        // Riesgo ARL.ms
        null,

        // Nombre/Telefono Contacto Emergencia.ms
        nombreEmergencia,
        telefonoEmergencia,

        // Banco / N° Cuenta Bancaria.ms
        null,
        null,

        // Chaqueta/Camiseta/Pantalon/Botas.ms
        a.camisa_talla || null,
        a.camisa_talla || null,
        a.talla_pantalon || null,
        a.zapatos_talla || null,

        // Numero.ms
        null,

        // Fecha_Ultima_Entrega.ms
        null,

        // Observaciones dotacion.ms
        null,

        // Estado.ms
        'Activo',

        // Centro de costos.ms (operación ingresada)
        operacion,

        // Operación.ms (operación ingresada)
        operacion,

        // Usuario.ms
        'Sistema'
        ];

        await connection.query(sqlSegmentacion, paramsSegmentacionNuevo);
        
        // 6. TABLA: Maestro_Vinculación (Incluyendo Regional y Cod Siesa)
        await connection.query(`
        INSERT INTO Maestro_Vinculación 
        (\`Id Vinculación\`, Trabajador, Identificación, Regional, Operación, Cargo, \`Cod Siesa\`, \`Fecha de Ingreso\`, Estado, \`Fecha Actualización\`, Usuario)
        VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'Activo', ${horaBogota}, 'Sistema')
        `, [nombreTrabajador, a.identificacion, regional, operacion, cargoRequerido, codSiesa, fecha_ingreso]);

        // 7. TABLA: Maestro_Examenes
        await connection.query(`
            INSERT INTO Maestro_Examenes 
            (\`Id Vinculación\`, Trabajador, Identificación, Operación, Estado, \`Fecha Actualización\`, Usuario)
            VALUES (UUID(), ?, ?, ?, 'Activo', ${horaBogota}, 'Sistema')
        `, [nombreTrabajador, a.identificacion, operacion]);

        // 8. TRASLADO DE ARCHIVOS Y Maestro_docTrabajador
        const [docs] = await connection.query(`
            SELECT d.*, c.Prefijo FROM Dynamic_hv_documentos d 
            JOIN Config_Doc_Trabajador c ON d.id_config_doc = c.Id WHERE d.id_aspirante = ?
        `, [id_aspirante]);
        
        const srcBucket = getBucketAspirantes();
        const destBucket = getBucketEmpleados();

        for (const doc of docs) {
            // Copia física entre buckets
            await srcBucket.file(doc.gcs_path).copy(destBucket.file(doc.gcs_path)).catch(e => console.log("Error copy storage:", e));

            // Registro en Maestro_docTrabajador (Incluye Regional)
            await connection.query(`
                INSERT INTO Maestro_docTrabajador 
                (id, Validación, Regional, Operación, Identificación, Estado, Fecha_Ingreso, TipoDocumento, Prefijo, Doc, Usuario)
                VALUES (UUID(), 'PEND', ?, ?, ?, 'Activo', ?, ?, ?, ?, 'Sistema')
            `, [regional, operacion, a.identificacion, fecha_ingreso, doc.id_config_doc, doc.Prefijo, doc.gcs_path]);
        }

        // 9. Bloqueo de proceso y cierre
        await connection.query('UPDATE Dynamic_hv_aspirante SET estado_proceso = "contratado" WHERE id_aspirante = ?', [id_aspirante]);

        await connection.commit();
        return jsonOk(res, {
        message: mensajeFinal,
        redirect: `/admin/${id_aspirante}`,
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Error en contratación:", error);
        return jsonError(res, error, { message: 'Error en contratación' });
    } finally {
        if (connection) connection.release();
    }
});

// --- 4. FUNCIÓN GENERAR HTML PORTAL ---
function generarHtmlPortal(uuid, nombre, docs, mapaDocs, pdfUrl) {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8"><title>Portal Aspirante | Logyser</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            body { font-family: 'Inter', sans-serif; }
            /* Estilos normales del portal aquí */
        </style>
    </head>
    <body class="bg-slate-50 p-4 md:p-8">
        <div class="max-w-3xl mx-auto">
            <div class="flex flex-col md:flex-row justify-between items-center mb-10 gap-6">
                <img src="https://storage.googleapis.com/logyser-recibo-public/logo.png" class="h-24 w-auto object-contain">
                <a href="https://curriculum-compact-594761951101.europe-west1.run.app" target="_blank" rel="noopener noreferrer">
                📝 Revisar o Editar mi Hoja de Vida
                </a>

                ${pdfUrl ? `
                <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer">
                    📄 Ver PDF de mi Hoja de Vida
                </a>
                ` : ``}
            </div>

            <div class="bg-white shadow-2xl rounded-3xl overflow-hidden border border-slate-100">
                <form action="/upload-multiple" method="POST" enctype="multipart/form-data" id="mainForm">
                    <input type="hidden" name="id_aspirante" value="${uuid}">
                    <input type="hidden" name="origen" value="portal">
                    <div class="p-8 md:p-12">
                        <h2 class="text-3xl font-bold text-slate-800 mb-2 italic">¡Hola, ${nombre}!</h2>
                        <p class="text-slate-500 mb-10 text-sm font-medium">Bienvenido al proceso de selección, a continuación, gestiona los documentos requeridos. Los documentos aprobados por Selección no podrán ser modificados.</p>
                        <div class="space-y-3">
                            ${docs.map(doc => {
                                const data = mapaDocs[doc.id];
                                const estaAprobado = data && data.estado === 'Aprobado';
                                const estaCargado = data && !estaAprobado;
                                
                                return `
                                <div class="flex flex-col md:flex-row md:items-center justify-between p-4 border ${estaAprobado ? 'border-green-200 bg-green-50' : 'border-slate-100 bg-white'} rounded-2xl shadow-sm">
                                    <div class="flex items-center space-x-3 flex-1">
                                        <div class="${estaAprobado ? 'text-green-500' : (estaCargado ? 'text-blue-500' : 'text-slate-300')}">
                                            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
                                        </div>
                                        <span class="text-sm font-semibold text-slate-700">${doc.nombre}</span>
                                    </div>
                                    <div class="flex items-center gap-2 mt-2 md:mt-0">
                                        ${estaAprobado ? 
                                            '<span class="text-[10px] font-black text-green-600 border border-green-200 px-3 py-1 rounded-lg bg-white uppercase">Aprobado</span>' : 
                                            (estaCargado ? 
                                                '<a href="https://storage.googleapis.com/hojas_vida_logyser/' + data.path + '" target="_blank" class="text-xs font-bold text-blue-600 px-3">Ver</a>' +
                                                '<button type="button" onclick="confirmarEliminar(' + doc.id + ')" class="text-xs font-bold text-red-400 hover:text-red-600 italic">Eliminar</button>' : 
                                                '<input type="file" name="file_' + doc.id + '" accept=".pdf" class="block w-full text-[11px] text-slate-500 file:mr-4 file:py-1 file:px-3 file:rounded-full file:border-0 file:bg-blue-50 file:text-blue-700 font-bold hover:file:bg-blue-100 uppercase text-[10px]">'
                                            )
                                        }
                                    </div>
                                </div>`;
                            }).join('')}
                        </div>
                        <div class="mt-12">
                            <button type="submit" id="btnSubmit" class="w-full bg-slate-800 text-white py-4 rounded-2xl font-bold shadow-lg hover:bg-slate-900 transition-all uppercase tracking-wider">
                                Cargar Documentos Seleccionados
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>

        <script>
            document.getElementById('mainForm')?.addEventListener('submit', async (e) => {
                e.preventDefault();

                const form = e.target;
                const btn = document.getElementById('btnSubmit');

                // Validación: al menos 1 archivo
                const inputs = form.querySelectorAll('input[type="file"]');
                const alguno = Array.from(inputs).some(i => i.files && i.files.length > 0);
                if (!alguno) {
                    alert('Selecciona al menos un archivo');
                    return;
                }

                // UI loading
                const originalText = btn ? btn.innerText : '';
                if (btn) {
                    btn.innerText = 'Enviando archivos...';
                    btn.disabled = true;
                    btn.classList.add('opacity-50', 'cursor-not-allowed');
                }

                try {
                    const formData = new FormData(form);

                    const resp = await fetch(form.action, {
                    method: 'POST',
                    body: formData,
                    });

                    const json = await resp.json().catch(() => null);

                    if (!resp.ok || !json || !json.ok) {
                    const msg = (json && (json.message || json.details)) ? `${json.message}\n${json.details || ''}` : 'Error subiendo documentos';
                    alert(msg);
                    return;
                    }

                    // éxito
                    if (json.redirect) {
                    window.location.href = json.redirect;
                    } else {
                    window.location.reload();
                    }
                } catch (err) {
                    alert(`Error de red: ${err?.message || err}`);
                } finally {
                    if (btn) {
                    btn.innerText = originalText;
                    btn.disabled = false;
                    btn.classList.remove('opacity-50', 'cursor-not-allowed');
                    }
                }
            });

            async function confirmarEliminar(id) {
            if (!confirm('¿Eliminar este documento?')) return;

            const resp = await fetch('/delete-doc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id_aspirante: '${uuid}', id_config_doc: id })
            });

            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data || !data.ok) {
                alert((data && (data.message + (data.details ? '\n' + data.details : ''))) || 'Error');
                return;
            }

            window.location.href = data.redirect || '/portal/${uuid}';
            }
        </script>
    </body></html>`;
}

function generarHtmlAdmin(uuid, asp, idsAsp, nombresAsp, docsTec, docsFir, mapa, bloqueado) {
    // Función interna para renderizar Técnicos y Firmas
    const renderFilaSeleccion = (doc) => {
        const data = mapa[doc.id]; // Aquí se define 'data'
        return `
        <div class="p-3 border-b border-slate-100 last:border-0">
            <div class="flex justify-between items-center mb-2">
                <span class="text-[11px] font-bold text-slate-700 uppercase">${doc.nombre}</span>
                ${data ? `
                    <div class="flex gap-2">
                        <a href="https://storage.googleapis.com/hojas_vida_logyser/${data.path}" target="_blank" class="text-[10px] text-blue-600 font-bold">VER</a>
                        ${!bloqueado ? '<button type="button" onclick="eliminar(' + doc.id + ')" class="text-[10px] text-red-400 font-bold italic">ELIMINAR</button>' : ''}
                    </div>
                ` : '<span class="text-[10px] text-slate-300 italic">Pendiente</span>'}
            </div>
            ${!data && !bloqueado ? `
                <div class="relative border-2 border-dashed border-slate-200 rounded-lg p-2 hover:border-blue-400 transition-colors bg-slate-50">
                    <input type="file" name="file_${doc.id}" accept=".pdf" 
                           onchange="this.parentElement.querySelector('.file-name').innerText = this.files[0].name; this.parentElement.classList.add('bg-blue-50', 'border-blue-400')"
                           class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                    <p class="text-[9px] text-center text-slate-400 file-name">Arrastra o haz clic para subir PDF</p>
                </div>
            ` : ''}
        </div>`;
    };

    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8"><title>Selección | Logyser</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            body { font-family: 'Inter', sans-serif; }
            
            /* El efecto gris que te gusta */
            .interfaz-bloqueada { 
                filter: grayscale(1);
                opacity: 0.7;
            }

            /* BLOQUEO SELECTIVO: Desactiva botones e inputs */
            .interfaz-bloqueada button, 
            .interfaz-bloqueada input, 
            .interfaz-bloqueada select { 
                pointer-events: none !important; 
                cursor: not-allowed;
            }

            /* RESCATE DEL BOTÓN VER: 
            Forzamos que los enlaces <a> sí reciban clics 
            y les devolvemos un poco de color al pasar el mouse */
            .interfaz-bloqueada a { 
                pointer-events: auto !important; 
                cursor: pointer !important;
                color: #2563eb !important; 
                text-decoration: underline;
            }
            
            .interfaz-bloqueada a:hover {
                filter: brightness(1.2);
            }
        </style>
    </head>
    <body class="bg-slate-100 p-6">
        <div class="max-w-7xl mx-auto ${bloqueado ? 'interfaz-bloqueada' : ''}">
            <div class="flex justify-between items-center mb-8 bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
                <img src="https://storage.googleapis.com/logyser-recibo-public/logo.png" class="h-16">
                <div class="text-right">
                    <h1 class="text-xl font-black text-slate-800 uppercase">${asp.nombreCompleto}</h1>
                    <p class="text-xs text-slate-400 font-mono italic">C.C. ${asp.identificacion}</p>
                    ${asp.requisicionInfo ? `<p class="text-xs text-slate-500 mt-1">${asp.requisicionInfo}</p>` : ``}
                    ${asp.pdfUrl ? `<p class="text-xs mt-1"><a class="text-blue-600 underline" href="${asp.pdfUrl}" target="_blank" rel="noopener noreferrer">Ver PDF Hoja de Vida</a></p>` : ``}
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                    <div class="p-4 bg-blue-600 text-white font-bold text-xs tracking-widest uppercase text-center">1. Validar Aspirante</div>
                    <div class="p-4 space-y-3">
                        ${idsAsp.map(id => {
                            const d = mapa[id];
                            const nombreDoc = nombresAsp[id];
                            return `
                            <div class="p-3 border rounded-2xl flex justify-between items-center ${d?.estado === 'Aprobado' ? 'bg-green-50 border-green-200' : ''}">
                                <div class="flex items-center gap-2">
                                    ${d && d.estado !== 'Aprobado' ? '<input type="checkbox" class="doc-check" value="' + id + '">' : ''}
                                    <span class="text-[11px] font-bold text-slate-600">${nombreDoc}</span>
                                </div>
                                <div class="flex gap-2 items-center">
                                    ${d ? '<a href="https://storage.googleapis.com/hojas_vida_logyser/' + d.path + '" target="_blank" class="text-[10px] font-bold text-blue-600">VER</a>' : ''}
                                    ${d && d.estado !== 'Aprobado' && !bloqueado ? 
                                    '<button type="button" onclick="eliminar(' + id + ')" class="text-[10px] text-red-400 italic font-bold">BORRAR</button>' 
                                    : (d?.estado === 'Aprobado' ? '<span class="text-[10px] font-black text-green-600 uppercase">✓</span>' : '')
                                    }
                                </div>
                            </div>`;
                        }).join('')}
                        <button onclick="aprobarMasivo()" class="w-full mt-4 bg-green-600 text-white py-3 rounded-xl text-[10px] font-black uppercase hover:bg-green-700 transition-all">Aprobar Seleccionados</button>
                    </div>
                </div>

                <form id="uploadFormTec" action="/upload-multiple" method="POST" enctype="multipart/form-data"
                    class="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden"
                    data-upload-form="1">
                    <input type="hidden" name="id_aspirante" value="${uuid}">
                    <input type="hidden" name="origen" value="admin">
                    <div class="p-4 bg-orange-500 text-white font-bold text-xs tracking-widest uppercase text-center">2. Documentos Técnicos</div>
                    <div class="p-2">${docsTec.map(renderFilaSeleccion).join('')}</div>
                    <div class="p-4">
                        <button type="submit" class="w-full bg-orange-500 text-white py-3 rounded-2xl font-bold text-xs transition-all">
                            CARGAR SECCIÓN
                        </button>
                    </div>
                </form>

                <form id="uploadFormFir" action="/upload-multiple" method="POST" enctype="multipart/form-data"
                    class="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden"
                    data-upload-form="1">
                    <input type="hidden" name="id_aspirante" value="${uuid}">
                    <input type="hidden" name="origen" value="admin">
                    <div class="p-4 bg-purple-600 text-white font-bold text-xs tracking-widest uppercase text-center">3. Documentos para Firmas</div>
                    <div class="p-2 h-[450px] overflow-y-auto">${docsFir.map(renderFilaSeleccion).join('')}</div>
                    <div class="p-4">
                        <button type="submit" class="w-full bg-purple-600 text-white py-3 rounded-2xl font-bold text-xs transition-all">
                            CARGAR SECCIÓN
                        </button>
                    </div>
                </form>
            </div>

            <div class="mt-12 text-center pb-20">
                <button id="btnEnviarSocio" type="button" data-idreq='${JSON.stringify(asp.IdRequisicion ?? null)}'
                    class="bg-slate-800 text-white px-16 py-6 rounded-3xl font-black text-xl shadow-2xl hover:scale-105 transition-all">
                    ENVIAR A SOCIODEMOGRÁFICA
                </button>
            </div>
        </div>

        <div id="modalContratacion" class="hidden fixed inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div class="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
                <h3 class="text-xl font-black text-slate-800 mb-6 italic uppercase tracking-tighter">Datos de Vinculación</h3>
               <form id="formFinal" action="/finalizar-contratacion" method="POST">
                    <input type="hidden" name="id_aspirante" value="${uuid}">
                    <input type="hidden" name="origen" value="admin">

                    <div class="mb-4">
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Regional</label>
                        <select id="selectRegional" name="regional" required
                        class="w-full border-2 border-slate-100 rounded-xl p-3 focus:border-blue-500 outline-none bg-white">
                        <option value="">Seleccione Regional</option>
                        </select>
                    </div>

                    <div class="mb-4">
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Operación</label>
                        <select id="selectOperacion" name="operacion" required
                        class="w-full border-2 border-slate-100 rounded-xl p-3 focus:border-blue-500 outline-none bg-white">
                        <option value="">Seleccione Operación</option>
                        </select>
                    </div>

                    <div class="mb-6">
                        <label class="block text-xs font-bold text-slate-500 uppercase mb-1">Fecha de Ingreso</label>
                        <input id="fechaIngreso" type="date" name="fecha_ingreso" required
                        class="w-full border-2 border-slate-100 rounded-xl p-3 focus:border-blue-500 outline-none">
                    </div>

                    <div class="flex space-x-3">
                        <button id="btnCancelarModal" type="button" class="flex-1 text-slate-400 font-bold">CANCELAR</button>
                        <button id="btnConfirmarVinculacion" type="submit"
                        class="flex-1 bg-blue-600 text-white py-3 rounded-xl font-black uppercase shadow-lg transition-all">
                        CONFIRMAR
                        </button>
                    </div>
                </form>
            </div>
        </div>
        
        <script> 
            const regionalSugerida = ${JSON.stringify(asp.regionalSugerida || '')};
            const operacionSugerida = ${JSON.stringify(asp.operacionSugerida || '')};                        
            async function eliminar(id) {
                if (!confirm('¿Eliminar permanentemente este documento?')) return;

                const resp = await fetch('/delete-doc-admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id_aspirante: '${uuid}', id_config_doc: id })
                });

                const data = await resp.json().catch(() => null);
                if (!resp.ok || !data || !data.ok) {
                    alert((data && (data.message + (data.details ? '\n' + data.details : ''))) || 'Error');
                    return;
                }

                window.location.href = data.redirect || '/admin/${uuid}';
            }
            async function aprobarMasivo() {
                const sel = Array.from(document.querySelectorAll('.doc-check:checked')).map(cb => cb.value);
                if (sel.length === 0) return alert('Selecciona documentos');

                const resp = await fetch('/aprobar-masivo', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                    id_aspirante: '${uuid}',
                    ids_docs: sel
                    })
                });

                const data = await resp.json().catch(() => null);
                if (!resp.ok || !data || !data.ok) {
                    alert((data && (data.message + (data.details ? '\n' + data.details : ''))) || 'Error');
                    return;
                }

                alert(data.message || 'OK');
                window.location.href = data.redirect || '/admin/${uuid}';
            }
            document.getElementById('btnEnviarSocio')?.addEventListener('click', async () => {
                const idReq = JSON.parse(document.getElementById('btnEnviarSocio').dataset.idreq || 'null');
                if (!idReq) {
                    alert('Es necesario que la hoja de vida esté vinculado a una requisición');
                    return;
                }
                if (!confirm('¿Está seguro de enviar la información a la Sociodemográfica?')) return;
                document.getElementById('modalContratacion').classList.remove('hidden');
            });
            
            async function cargarOperaciones(regional) {
                const selOp = document.getElementById('selectOperacion');
                selOp.innerHTML = '<option value="">Cargando...</option>';

                if (!regional) {
                selOp.innerHTML = '<option value="">Seleccione Operación</option>';
                return;
                }

                const data = await fetch('/api/operaciones/' + encodeURIComponent(regional)).then(r => r.json());
                selOp.innerHTML = '<option value="">Seleccione Operación</option>';
                data.forEach(op => selOp.add(new Option(op, op)));

                // Prefill operación si aplica
                if (operacionSugerida) selOp.value = operacionSugerida;
            }

            // Cargar regionales (y aplicar prefill)
            fetch('/api/regionales')
                .then(r => r.json())
                .then(async (data) => {
                const sel = document.getElementById('selectRegional');

                // reset (por si el HTML ya trae algo)
                sel.innerHTML = '<option value="">Seleccione Regional</option>';
                data.forEach(reg => sel.add(new Option(reg, reg)));

                // Prefill regional si aplica
                if (regionalSugerida) {
                    sel.value = regionalSugerida;
                    await cargarOperaciones(regionalSugerida);
                }
                });

            // Si el analista cambia la regional, recargar operaciones (y NO forzar la sugerida)
            document.getElementById('selectRegional').addEventListener('change', async (e) => {
                // al cambiar regional manualmente, ya no aplicamos operacionSugerida
                // (si quieres que sí intente seleccionarla si existe en esa regional, me dices)
                await cargarOperaciones(e.target.value);
            });

            window.__PREFILL__ = {
                regional: ${JSON.stringify(asp.regionalSugerida || '')},
                operacion: ${JSON.stringify(asp.operacionSugerida || '')}
            };
            document.getElementById('formFinal')?.addEventListener('submit', async (e) => {
                e.preventDefault();

                const form = e.target;
                const payload = new URLSearchParams(new FormData(form));

                const resp = await fetch('/finalizar-contratacion', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: payload.toString()
                });

                const data = await resp.json().catch(() => null);
                if (!resp.ok || !data || !data.ok) {
                    alert((data && (data.message + (data.details ? '\n' + data.details : ''))) || 'Error en contratación');
                    return;
                }

                alert(data.message || 'Enviado');
                window.location.href = data.redirect || '/admin/${uuid}';
            });
            // Cerrar modal
            document.getElementById('btnCancelarModal')?.addEventListener('click', () => {
            document.getElementById('modalContratacion')?.classList.add('hidden');
            });

            // Cuando cambia regional => cargar operaciones
            document.getElementById('selectRegional')?.addEventListener('change', async (e) => {
            await cargarOperaciones(e.target.value);
            });

            // Submit del formFinal (evita submit normal y pone loading sin inline JS)
            document.getElementById('formFinal')?.addEventListener('submit', async (e) => {
            e.preventDefault();

            const form = e.target;
            const btn = document.getElementById('btnConfirmarVinculacion');

            const originalText = btn ? btn.innerText : '';
            if (btn) {
                btn.disabled = true;
                btn.innerText = 'PROCESANDO...';
                btn.classList.add('opacity-50', 'pointer-events-none');
            }

            try {
                const payload = new URLSearchParams(new FormData(form));

                const resp = await fetch(form.action, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: payload.toString()
                });

                const data = await resp.json().catch(() => null);
                if (!resp.ok || !data || !data.ok) {
                alert((data && (data.message + (data.details ? '\n' + data.details : ''))) || 'Error en contratación');
                return;
                }

                window.location.href = data.redirect || '/admin/${uuid}';
            } catch (err) {
                alert('Error de red: ' + (err?.message || err));
            } finally {
                if (btn) {
                btn.disabled = false;
                btn.innerText = originalText || 'CONFIRMAR';
                btn.classList.remove('opacity-50', 'pointer-events-none');
                }
            }
            });
        </script>
        
        <script>
            async function submitUploadForm(form) {
                const btn = form.querySelector('button[type="submit"]');
                const fd = new FormData(form);

                const fileInputs = form.querySelectorAll('input[type="file"]');
                const alguno = Array.from(fileInputs).some(i => i.files && i.files.length > 0);
                if (!alguno) { alert('Selecciona al menos un archivo en esta sección'); return; }

                if (btn) { btn.disabled = true; btn.innerText = 'Subiendo...'; }

                try {
                    const r = await fetch(form.action, { method: 'POST', body: fd });
                    const j = await r.json().catch(() => null);

                    if (!r.ok || !j || !j.ok) {
                    alert((j && (j.message + (j.details ? '\n' + j.details : ''))) || 'Error subiendo archivos');
                    return;
                    }

                    window.location.href = j.redirect || '/admin/${uuid}';
                } catch (e) {
                    alert('Error de red subiendo archivos');
                } finally {
                    if (btn) { btn.disabled = false; btn.innerText = 'CARGAR SECCIÓN'; }
                }
                }

                document.getElementById('uploadFormTec')?.addEventListener('submit', (e) => {
                e.preventDefault();
                submitUploadForm(e.target);
                });

                document.getElementById('uploadFormFir')?.addEventListener('submit', (e) => {
                e.preventDefault();
                submitUploadForm(e.target);
            });
        </script>
    </body></html>`;
}



const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));