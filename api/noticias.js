// api/noticias.js
// Usa Claude con BÚSQUEDA WEB EN VIVO (server tool) para traer
// noticias REALES de las últimas 24 horas. Una sola llamada.

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY en Vercel' });
  }

  // ── Ventana 7am (ayer) → 7am (hoy), hora Ciudad de México ──
  const ahora = new Date();
  const fmt = (d) => d.toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Mexico_City'
  });
  const hoy = fmt(ahora);
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  const ayerStr = fmt(ayer);

  const prompt = `Eres el editor en jefe de LAS SIETE, un newsletter premium mexicano.

Hoy es ${hoy}, son aproximadamente las 7:00 am en Ciudad de México.

BUSCA EN LA WEB las noticias más importantes de las ÚLTIMAS 24 HORAS (entre las 7:00 am del ${ayerStr} y las 7:00 am de ${hoy}, hora de México).

IMPORTANTE: haz pocas búsquedas pero amplias (máximo 5 en total) para no demorarte. Por ejemplo:
1. "noticias México hoy ${hoy}"
2. "breaking world news today"
3. "tech AI news today"
4. "resultados deportivos México hoy"
Y una búsqueda extra solo si te falta cubrir alguna sección.

Después de buscar, selecciona SOLO hechos reales de las últimas 24 horas que encontraste. Si una noticia es más vieja, NO la incluyas.

Para cada noticia genera un "xQuery": 2-4 palabras clave en español para buscarla en X (Twitter).

Cuando termines de buscar, responde ÚNICAMENTE con este JSON, sin texto antes ni después, sin markdown:

{
  "fecha_corte": "${hoy} 07:00 hrs",
  "portada": {
    "titular": "La noticia de mayor impacto del día, máx 14 palabras con verbo activo",
    "resumen": "Dos oraciones: hecho concreto + implicación para el lector mexicano.",
    "xQuery": "palabras clave X"
  },
  "mexico": [
    { "categoria": "CATEGORÍA", "titular": "Máx 12 palabras", "resumen": "Hecho concreto en una oración.", "xQuery": "palabras clave X" }
  ],
  "mundo": [
    { "categoria": "CATEGORÍA", "titular": "Máx 12 palabras", "resumen": "Hecho concreto en una oración.", "xQuery": "palabras clave X" }
  ],
  "tecnologia": [
    { "categoria": "CATEGORÍA", "titular": "Máx 11 palabras", "resumen": "Hecho esencial en una oración.", "xQuery": "palabras clave X" }
  ],
  "deportes": [
    { "categoria": "CATEGORÍA", "titular": "Máx 12 palabras", "resumen": "Resultado o hecho deportivo concreto.", "xQuery": "palabras clave X" }
  ]
}

REGLAS:
- mexico: exactamente 7 noticias
- mundo: exactamente 7 noticias
- tecnologia: exactamente 8 noticias
- deportes: exactamente 3 noticias
- SOLO noticias reales de las últimas 24 horas que encontraste en tus búsquedas
- Titulares directos, sin sensacionalismo
- Tu respuesta final debe ser SOLO el JSON`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        // ── BÚSQUEDA WEB EN VIVO: el server tool de Anthropic ──
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 5
          }
        ],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const bodyText = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        error: `Anthropic error ${response.status}`,
        detail: bodyText.slice(0, 800)
      });
    }

    const data = JSON.parse(bodyText);

    // Con web search, content trae varios bloques (texto, tool_use,
    // search results, texto final). Unimos SOLO los bloques de texto.
    let raw = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n');

    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(502).json({
        error: 'Claude no devolvió JSON',
        muestra: raw.slice(0, 800)
      });
    }

    let edicion;
    try {
      edicion = JSON.parse(raw.slice(start, end + 1));
    } catch (e) {
      return res.status(502).json({
        error: 'JSON malformado',
        muestra: raw.slice(0, 800)
      });
    }

    if (!edicion.portada || !edicion.mexico || !edicion.mundo) {
      return res.status(502).json({
        error: 'JSON incompleto',
        recibido: Object.keys(edicion)
      });
    }

    // Cache 30 min: evita re-buscar (y re-pagar) en cada visita
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(edicion);

  } catch (err) {
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
