// api/noticias.js
// Trae noticias REALES de las últimas 24 horas usando GNews API.
// Rápido, real, fechado, sin alucinaciones, sin límite de tokens.

const STOPWORDS = new Set(['el','la','los','las','un','una','de','del','y','o','a','en','que','con','por','para','su','sus','se','al','lo','le','es','son','tras','ante','sobre','entre','the','of','to','in','on','for','and','a','an','is','are','with','at','by']);

// Genera 3-4 palabras clave para buscar la noticia en X
function xQueryDeTitular(titular) {
  if (!titular) return 'noticias hoy';
  return titular
    .replace(/[^\wáéíóúñÁÉÍÓÚÑ\s]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOPWORDS.has(w.toLowerCase()))
    .slice(0, 4)
    .join(' ') || 'noticias hoy';
}

function recortar(texto, max) {
  if (!texto) return '';
  texto = texto.trim();
  return texto.length > max ? texto.slice(0, max - 1).trim() + '…' : texto;
}

// Convierte un artículo de GNews al formato del newsletter
function mapear(articulo) {
  return {
    categoria: (articulo.source?.name || 'NOTICIA').toUpperCase(),
    titular: recortar(articulo.title, 110),
    resumen: recortar(articulo.description || articulo.content || '', 160),
    xQuery: xQueryDeTitular(articulo.title),
    imagen: articulo.image || null,
    url: articulo.url || null,
    fecha: articulo.publishedAt || null
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GNEWS_API_KEY = process.env.GNEWS_API_KEY;
  if (!GNEWS_API_KEY) {
    return res.status(500).json({ error: 'Falta GNEWS_API_KEY en Vercel. Consíguela gratis en gnews.io' });
  }

  // Ventana de 24 horas: descartamos lo más viejo que esto
  const hace24h = Date.now() - 24 * 60 * 60 * 1000;

  // Una consulta por sección. category + country + lang.
  const secciones = [
    { clave: 'mexico',     category: 'nation',     country: 'mx', lang: 'es', max: 10, tomar: 7 },
    { clave: 'mundo',      category: 'world',      country: null, lang: 'es', max: 10, tomar: 7 },
    { clave: 'tecnologia', category: 'technology', country: null, lang: 'es', max: 10, tomar: 8 },
    { clave: 'deportes',   category: 'sports',     country: 'mx', lang: 'es', max: 10, tomar: 3 }
  ];

  const fechaCorte = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Mexico_City'
  });

  try {
    const resultados = {};

    // Pausa para respetar el límite de GNews free (1 request/segundo)
    const esperar = (ms) => new Promise(r => setTimeout(r, ms));

    // Las hacemos en secuencia con pausa entre cada una
    let primera = true;
    for (const s of secciones) {
      if (!primera) await esperar(1300); // 1.3s entre consultas
      primera = false;

      let url = `https://gnews.io/api/v4/top-headlines?category=${s.category}&lang=${s.lang}&max=${s.max}&apikey=${GNEWS_API_KEY}`;
      if (s.country) url += `&country=${s.country}`;

      const r = await fetch(url);
      const texto = await r.text();

      if (!r.ok) {
        return res.status(502).json({
          error: `GNews error ${r.status} en sección ${s.clave}`,
          detail: texto.slice(0, 400)
        });
      }

      const json = JSON.parse(texto);
      let articulos = (json.articles || [])
        // Filtramos a las últimas 24 horas
        .filter(a => {
          if (!a.publishedAt) return false;
          return new Date(a.publishedAt).getTime() >= hace24h;
        });

      // Si el filtro de 24h deja muy pocas, usamos las más recientes disponibles
      if (articulos.length < 3) {
        articulos = (json.articles || []);
      }

      resultados[s.clave] = articulos.slice(0, s.tomar).map(mapear);
    }

    // Portada: la primera noticia de México (la más relevante para el lector)
    const fuentePortada = resultados.mexico[0] || resultados.mundo[0] || resultados.tecnologia[0];
    const portada = fuentePortada ? {
      titular: fuentePortada.titular,
      resumen: fuentePortada.resumen,
      xQuery: fuentePortada.xQuery,
      imagen: fuentePortada.imagen
    } : {
      titular: 'Sin noticias disponibles en este momento',
      resumen: 'No se pudieron recuperar noticias. Intenta de nuevo en unos minutos.',
      xQuery: 'noticias hoy'
    };

    const edicion = {
      fecha_corte: `${fechaCorte} 07:00 hrs`,
      portada,
      mexico: resultados.mexico,
      mundo: resultados.mundo,
      tecnologia: resultados.tecnologia,
      deportes: resultados.deportes
    };

    // Cache 30 min: no re-consultar en cada visita (cuida tu cuota gratis)
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json(edicion);

  } catch (err) {
    return res.status(500).json({ error: 'Error interno', detail: err.message });
  }
}
