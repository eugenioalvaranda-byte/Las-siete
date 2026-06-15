// api/noticias.js
// Una sola llamada a Grok con BÚSQUEDA EN VIVO activada.
// Esta es la pieza clave: search_parameters hace que Grok busque
// noticias reales en X y la web, en vez de usar solo su memoria.

export default async function handler(req, res) {
  // Permitir tanto GET (para probar en el browser) como POST
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const XAI_API_KEY = process.env.XAI_API_KEY;
  if (!XAI_API_KEY) {
    return res.status(500).json({ error: 'Falta XAI_API_KEY en las variables de entorno de Vercel' });
  }

  // ── Ventana de tiempo: 7am de ayer → 7am de hoy (hora CDMX) ──
  const ahora = new Date();
  const fmt = (d) => d.toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Mexico_City'
  });
  const hoy = fmt(ahora);
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  const ayerStr = fmt(ayer);

  // Fechas en formato ISO (YYYY-MM-DD) para acotar la búsqueda de Grok
  const isoHoy = ahora.toISOString().slice(0, 10);
  const isoAyer = ayer.toISOString().slice(0, 10);

  const prompt = `Eres el editor en jefe de LAS SIETE, un newsletter premium mexicano.

Busca las noticias MÁS IMPORTANTES Y REALES publicadas entre el ${ayerStr} y el ${hoy}.

Necesito:
- 7 noticias de MÉXICO (política, economía, seguridad, sociedad, cultura, etc.)
- 7 noticias del MUNDO (geopolítica, EE.UU., Europa, Asia, economía global, etc.)
- 8 noticias de TECNOLOGÍA Y CIENCIA (IA, espacio, biomedicina, hardware, energía, etc.)

La PORTADA debe ser la noticia de mayor impacto para un lector mexicano.

Responde ÚNICAMENTE con este JSON exacto, sin texto antes ni después, sin markdown:

{
  "portada": {
    "titular": "Titular de máximo 14 palabras con verbo activo",
    "resumen": "Dos oraciones: el hecho concreto + su implicación para México. Máximo 40 palabras."
  },
  "mexico": [
    { "categoria": "CATEGORÍA EN MAYÚSCULAS", "titular": "Máximo 12 palabras", "resumen": "Una oración con el dato más importante." }
  ],
  "mundo": [
    { "categoria": "CATEGORÍA EN MAYÚSCULAS", "titular": "Máximo 12 palabras", "resumen": "Una oración con el dato clave." }
  ],
  "tecnologia": [
    { "categoria": "CATEGORÍA EN MAYÚSCULAS", "titular": "Máximo 11 palabras", "resumen": "Una oración esencial." }
  ]
}

REGLAS:
- mexico: exactamente 7 objetos
- mundo: exactamente 7 objetos
- tecnologia: exactamente 8 objetos
- Solo noticias REALES que encontraste en tu búsqueda, nunca inventadas
- Solo JSON puro`;

  try {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${XAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-3-latest',
        // ── ESTO ES LO QUE FALTABA: búsqueda en vivo ──
        search_parameters: {
          mode: 'on',                    // fuerza la búsqueda en tiempo real
          return_citations: true,
          from_date: isoAyer,
          to_date: isoHoy,
          max_search_results: 30,
          sources: [
            { type: 'web' },
            { type: 'news' },
            { type: 'x' }
          ]
        },
        messages: [
          { role: 'system', content: 'Eres un editor de noticias experto. Buscas noticias reales y respondes siempre en JSON puro válido, sin markdown ni explicaciones.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 4000
      })
    });

    const bodyText = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        error: `xAI respondió con error ${response.status}`,
        detail: bodyText.slice(0, 500)
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
      return res.status(502).json({ error: 'JSON malformado de Grok', muestra: raw.slice(0, 500) });
    }

    if (!edicion.portada || !edicion.mexico || !edicion.mundo || !edicion.tecnologia) {
      return res.status(502).json({ error: 'JSON incompleto', recibido: Object.keys(edicion) });
    }

    // Cache de 30 min para no gastar de más en llamadas repetidas
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(edicion);

  } catch (err) {
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
