const express = require('express');
const path = require('path');
const upload = require('./middlewares/upload');
const documentoController = require('./controllers/documentoController');
const db = require('./config/db');
const { getBucketAspirantes, getBucketEmpleados } = require('./config/gcs');
const fs = require('fs');

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

        const docsHtml = docsAspirante.map(doc => {
  const data = mapaDocs[doc.id];
  const estaAprobado = data && data.estado === 'Aprobado';
  const estaCargado = data && !estaAprobado;

  if (estaAprobado) {
    return `
      <div class="p-3 border rounded-xl bg-green-50 border-green-200 flex justify-between">
        <span class="font-bold text-sm">${doc.nombre}</span>
        <span class="text-xs font-black text-green-700">APROBADO</span>
      </div>
    `;
  }

  if (estaCargado) {
    return `
      <div class="p-3 border rounded-xl flex justify-between">
        <span class="font-bold text-sm">${doc.nombre}</span>
        <div class="flex gap-3">
          <a class="text-blue-600 font-bold text-xs" target="_blank"
             href="https://storage.googleapis.com/hojas_vida_logyser/${data.path}">VER</a>
          <button type="button" class="text-red-500 font-bold text-xs"
            data-delete-doc="${doc.id}">ELIMINAR</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="p-3 border rounded-xl flex justify-between items-center">
      <span class="font-bold text-sm">${doc.nombre}</span>
      <input type="file" name="file_${doc.id}" accept=".pdf" class="text-xs" />
    </div>
  `;
}).join('');

const pdfLink = pdfUrl
  ? `<a href="${pdfUrl}" target="_blank" rel="noopener noreferrer" class="font-bold">📄 Ver PDF de mi Hoja de Vida</a>`
  : '';

const html = renderTemplate(path.join(__dirname, 'views', 'portal.html'), {
  UUID: uuid,
  NOMBRE: nombre,
  DOCS_HTML: docsHtml,
  PDF_LINK: pdfLink,
});

res.send(html);
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
        const pdfLinkAdmin = pdfUrl
  ? `<p class="mt-2"><a class="text-blue-600 underline" href="${pdfUrl}" target="_blank" rel="noopener noreferrer">Ver PDF Hoja de Vida</a></p>`
  : '';

const html = renderTemplate(path.join(__dirname, 'views', 'admin.html'), {
  UUID: uuid,
  NOMBRE_COMPLETO: nombreCompleto,
  IDENTIFICACION: a.identificacion,
  REQUISICION_INFO: requisicionInfo || '',
  PDF_LINK: pdfLinkAdmin,
  IDREQ_JSON: JSON.stringify(a.IdRequisicion ?? null),
  REGIONAL_SUGERIDA_JSON: JSON.stringify(regionalSugerida || ''),
  OPERACION_SUGERIDA_JSON: JSON.stringify(operacionSugerida || ''),
});

res.send(html);

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

function renderTemplate(filePath, vars) {
  let html = fs.readFileSync(filePath, 'utf8');
  for (const [k, v] of Object.entries(vars)) {
    html = html.split(`{{${k}}}`).join(String(v ?? ''));
  }
  return html;
}



const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`✅ Servidor corriendo en puerto ${PORT}`));