// api/noticias.js
// 1) GNews trae noticias REALES de las últimas 24h (con fotos).
// 2) Claude CURA (quita amarillismo, deja solo lo que pesa) y REESCRIBE
//    en un tono amigable, como si tú se lo platicaras a un amigo.

const STOPWORDS = new Set(['el','la','los','las','un','una','de','del','y','o','a','en','que','con','por','para','su','sus','se','al','lo','le','es','son','tras','ante','sobre','entre','the','of','to','in','on','for','and','an','is','are','with','at','by']);

function xQueryDeTitular(titular) {
  if (!titular) return 'noticias hoy';
  return titular
    .replace(/[^\wáéíóúñÁÉÍÓÚÑ\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, 4)
    .join(' ') || 'noticias hoy';
}

function recortar(t, max) {
  if (!t) return '';
  t = t.trim();
  return t.length > max ? t.slice(0, max - 1).trim() + '…' : t;
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GNEWS_API_KEY = process.env.GNEWS_API_KEY;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!GNEWS_API_KEY) {
    return res.status(500).json({ error: 'Falta GNEWS_API_KEY en Vercel' });
  }

  const hace24h = Date.now() - 24 * 60 * 60 * 1000;
  const fechaCorte = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Mexico_City'
  });

  // Pedimos el máximo de candidatos para que Claude pueda CURAR bien
  const secciones = [
    { clave: 'mexico',     category: 'nation',     country: 'mx', max: 10, tope: 10 },
    { clave: 'mundo',      category: 'world',      country: null, max: 10, tope: 10 },
    { clave: 'finanzas',   category: 'business',   country: 'mx', max: 10, tope: 10 },
    { clave: 'tecnologia', category: 'technology', country: null, max: 10, tope: 10 },
    { clave: 'deportes',   category: 'sports',     country: 'mx', max: 10, tope: 10 }
  ];

  const esperar = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    // ── PASO 1: GNews ──
    const crudas = {};          // articulos crudos por seccion
    const indice = {};          // id -> articulo original (para re-pegar foto/fuente)
    const candidatos = [];      // lista plana para mandar a Claude
    let id = 0;
    let primera = true;

    for (const s of secciones) {
      if (!primera) await esperar(1300); // respeta 1 req/seg de GNews
      primera = false;

      let url = `https://gnews.io/api/v4/top-headlines?category=${s.category}&lang=es&max=${s.max}&apikey=${GNEWS_API_KEY}`;
      if (s.country) url += `&country=${s.country}`;

      const r = await fetch(url);
      const texto = await r.text();
      if (!r.ok) {
        return res.status(502).json({ error: `GNews error ${r.status} en ${s.clave}`, detail: texto.slice(0, 400) });
      }

      const json = JSON.parse(texto);
      const todos = json.articles || [];
      const esReciente = (a) => a.publishedAt && new Date(a.publishedAt).getTime() >= hace24h;

      // Priorizamos las de las últimas 24h; si faltan, completamos con las más recientes
      let arts = todos.filter(esReciente);
      if (arts.length < s.tope) {
        const resto = todos.filter(a => !esReciente(a));
        arts = arts.concat(resto);
      }
      arts = arts.slice(0, s.tope);

      crudas[s.clave] = [];
      for (const a of arts) {
        indice[id] = {
          fuente: (a.source?.name || 'Noticia'),
          imagen: a.image || null,
          url: a.url || null,
          xQuery: xQueryDeTitular(a.title)
        };
        candidatos.push({
          id,
          seccion: s.clave,
          fuente: a.source?.name || 'Noticia',
          titulo: recortar(a.title, 120),
          desc: recortar(a.description || a.content || '', 180)
        });
        crudas[s.clave].push(id);
        id++;
      }
    }

    // ── PASO 2: Claude cura y reescribe (si hay key) ──
    let textos = {}; // id -> texto reescrito
    if (ANTHROPIC_API_KEY && candidatos.length) {
      const promptCuracion = `Eres el editor de LAS SIETE, un newsletter mexicano con voz cálida y cercana.

Te paso las noticias crudas de hoy (con su id, sección, fuente, título y descripción). Tu trabajo:

1. CURAR: conserva las noticias de interés general con peso real. DESCARTA nota roja, amarillismo, crímenes locales, violencia y muertes, SALVO que sea un hecho nacional o mundial de altísima relevancia. No descartes de más: noticias de política seria, economía, acuerdos, ciencia, empresas, cultura o deporte relevante SÍ entran. Solo evita lo morboso o trivial.

2. REESCRIBIR: para cada noticia que conserves, escribe una explicación de 1 o 2 oraciones en español de México, en tono AMIGABLE y conversacional, como si se lo platicaras a un amigo inteligente. Claro, cálido, directo al grano, sin tecnicismos ni sensacionalismo. No uses el título original; cuenta el hecho con tus palabras.

Devuelve ÚNICAMENTE este JSON, sin markdown ni texto extra:
{ "keep": [ { "id": 0, "texto": "tu explicación amigable" } ] }

Conserva hasta 7 por sección (México, Mundo, Finanzas, Tecnología) y hasta 5 en Deportes. Prioriza las más recientes y relevantes. Si una sección tiene varias buenas, incluye 6-7; no te quedes corto sin razón.

NOTICIAS CRUDAS:
${JSON.stringify(candidatos)}`;

      try {
        const cr = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 2500,
            temperature: 0.4,
            messages: [{ role: 'user', content: promptCuracion }]
          })
        });

        if (cr.ok) {
          const cd = await cr.json();
          let raw = (cd.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
          raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
          const s0 = raw.indexOf('{'), e0 = raw.lastIndexOf('}');
          if (s0 !== -1 && e0 !== -1) {
            const parsed = JSON.parse(raw.slice(s0, e0 + 1));
            (parsed.keep || []).forEach(k => {
              if (typeof k.id === 'number' && k.texto) textos[k.id] = k.texto.trim();
            });
          }
        }
        // Si Claude falla, seguimos con las descripciones crudas (degradación elegante)
      } catch (e) { /* fallback abajo */ }
    }

    const usoClaude = Object.keys(textos).length > 0;

    // ── PASO 3: armar la edición ──
    function construirSeccion(clave) {
      const ids = crudas[clave] || [];
      const items = [];
      for (const i of ids) {
        const orig = indice[i];
        // Si Claude curó, solo incluimos los que conservó.
        // Si Claude no corrió, incluimos todos con su descripción cruda.
        let texto;
        if (usoClaude) {
          if (!(i in textos)) continue;     // Claude lo descartó
          texto = textos[i];
        } else {
          const c = candidatos.find(x => x.id === i);
          texto = c ? (c.desc || c.titulo) : '';
        }
        if (!texto) continue;
        items.push({
          fuente: orig.fuente,
          texto,
          xQuery: orig.xQuery,
          imagen: orig.imagen,
          url: orig.url
        });
      }
      return items;
    }

    const edicion = {
      fecha_corte: `${fechaCorte} · corte 07:00 hrs`,
      curada: usoClaude,
      mexico: construirSeccion('mexico'),
      mundo: construirSeccion('mundo'),
      finanzas: construirSeccion('finanzas'),
      tecnologia: construirSeccion('tecnologia'),
      deportes: construirSeccion('deportes')
    };

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(edicion);

  } catch (err) {
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
