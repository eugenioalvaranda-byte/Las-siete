// api/noticias.js — Grok sin tools, prompt directo para noticias reales
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const XAI_API_KEY = process.env.XAI_API_KEY;
  if (!XAI_API_KEY) {
    return res.status(500).json({ error: 'Falta XAI_API_KEY en Vercel' });
  }

  const ahora = new Date();
  const fmt = (d) => d.toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Mexico_City'
  });
  const hoy = fmt(ahora);
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  const ayerStr = fmt(ayer);

  const prompt = `Eres el editor en jefe de LAS SIETE, newsletter premium mexicano.
Fecha de hoy: ${hoy}.

Con base en tu conocimiento actualizado de noticias recientes, genera la edición de hoy.

Responde ÚNICAMENTE con este JSON exacto, sin texto antes ni después, sin markdown, sin explicaciones:

{
  "portada": {
    "titular": "Titular máximo 14 palabras con verbo activo",
    "resumen": "Dos oraciones: hecho concreto + implicación para México. Máximo 40 palabras."
  },
  "mexico": [
    { "categoria": "POLÍTICA", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con el dato más importante." },
    { "categoria": "ECONOMÍA", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con el dato más importante." },
    { "categoria": "SEGURIDAD", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con el dato más importante." },
    { "categoria": "SOCIEDAD", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con el dato más importante." },
    { "categoria": "CULTURA", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con el dato más importante." },
    { "categoria": "INFRAESTRUCTURA", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con el dato más importante." },
    { "categoria": "RELACIÓN EE.UU.", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con el dato más importante." }
  ],
  "mundo": [
    { "categoria": "GEOPOLÍTICA", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con dato clave." },
    { "categoria": "ESTADOS UNIDOS", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con dato clave." },
    { "categoria": "EUROPA", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con dato clave." },
    { "categoria": "ASIA", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con dato clave." },
    { "categoria": "LATINOAMÉRICA", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con dato clave." },
    { "categoria": "ECONOMÍA GLOBAL", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con dato clave." },
    { "categoria": "CONFLICTO", "titular": "Titular máximo 12 palabras", "resumen": "Una oración con dato clave." }
  ],
  "tecnologia": [
    { "categoria": "INTELIGENCIA ARTIFICIAL", "titular": "Titular máximo 11 palabras", "resumen": "Una oración esencial." },
    { "categoria": "ESPACIO", "titular": "Titular máximo 11 palabras", "resumen": "Una oración esencial." },
    { "categoria": "BIOMEDICINA", "titular": "Titular máximo 11 palabras", "resumen": "Una oración esencial." },
    { "categoria": "HARDWARE", "titular": "Titular máximo 11 palabras", "resumen": "Una oración esencial." },
    { "categoria": "CIBERSEGURIDAD", "titular": "Titular máximo 11 palabras", "resumen": "Una oración esencial." },
    { "categoria": "ENERGÍA", "titular": "Titular máximo 11 palabras", "resumen": "Una oración esencial." },
    { "categoria": "MÓVILES", "titular": "Titular máximo 11 palabras", "resumen": "Una oración esencial." },
    { "categoria": "CIENCIA", "titular": "Titular máximo 11 palabras", "resumen": "Una oración esencial." }
  ]
}`;

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-3-latest',
        messages: [
          {
            role: 'system',
            content: 'Eres un editor de noticias experto en México y el mundo. Tienes conocimiento actualizado de los eventos más recientes. Respondes SIEMPRE con JSON puro válido, sin markdown, sin texto adicional.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 4000
      })
    });

    const bodyText = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        error: `xAI error ${response.status}`,
        detail: bodyText.slice(0, 800)
      });
    }

    const data = JSON.parse(bodyText);
    let raw = data.choices?.[0]?.message?.content || '';
    raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(502).json({ 
        error: 'Grok no devolvió JSON', 
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

    if (!edicion.portada || !edicion.mexico || !edicion.mundo || !edicion.tecnologia) {
      return res.status(502).json({ 
        error: 'JSON incompleto', 
        recibido: Object.keys(edicion) 
      });
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(edicion);

  } catch (err) {
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
