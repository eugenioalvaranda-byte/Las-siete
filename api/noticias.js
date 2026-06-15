// api/noticias.js — Grok con Agent Tools API (live search actualizado)
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

Busca en internet las noticias MÁS IMPORTANTES publicadas entre el ${ayerStr} y el ${hoy}.

Necesito exactamente:
- 7 noticias de MÉXICO
- 7 noticias del MUNDO  
- 8 noticias de TECNOLOGÍA Y CIENCIA

La PORTADA es la noticia de mayor impacto para México.

Responde ÚNICAMENTE con este JSON, sin texto antes ni después, sin markdown:

{
  "portada": {
    "titular": "Titular máximo 14 palabras con verbo activo",
    "resumen": "Dos oraciones: hecho concreto + implicación para México. Máximo 40 palabras."
  },
  "mexico": [
    { "categoria": "CATEGORÍA EN MAYÚSCULAS", "titular": "Máximo 12 palabras", "resumen": "Una oración con el dato más importante." }
  ],
  "mundo": [
    { "categoria": "CATEGORÍA EN MAYÚSCULAS", "titular": "Máximo 12 palabras", "resumen": "Una oración con dato clave." }
  ],
  "tecnologia": [
    { "categoria": "CATEGORÍA EN MAYÚSCULAS", "titular": "Máximo 11 palabras", "resumen": "Una oración esencial." }
  ]
}

REGLAS: mexico=7 items, mundo=7 items, tecnologia=8 items. Solo noticias reales. Solo JSON puro.`;

  try {
    // Nuevo endpoint con Agent Tools (web_search)
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-3-latest',
        tools: [
          {
            type: 'function',
            function: {
              name: 'web_search',
              description: 'Search the web for current news and information',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query' }
                },
                required: ['query']
              }
            }
          }
        ],
        tool_choice: 'auto',
        messages: [
          {
            role: 'system',
            content: 'Eres un editor de noticias experto. Usas web_search para buscar noticias reales y actuales. Respondes siempre en JSON puro válido, sin markdown.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
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
      return res.status(502).json({ error: 'Grok no devolvió JSON', muestra: raw.slice(0, 500) });
    }

    let edicion;
    try {
      edicion = JSON.parse(raw.slice(start, end + 1));
    } catch (e) {
      return res.status(502).json({ error: 'JSON malformado', muestra: raw.slice(0, 500) });
    }

    if (!edicion.portada || !edicion.mexico || !edicion.mundo || !edicion.tecnologia) {
      return res.status(502).json({ error: 'JSON incompleto', recibido: Object.keys(edicion) });
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(edicion);

  } catch (err) {
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
