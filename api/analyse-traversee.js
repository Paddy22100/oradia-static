// Force Node.js (important pour process.env)
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://oradia.fr");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  // Sécurité: clé présente ?
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY absente côté serveur" });
  }

  try {
    const body = req.body || {};
    const b = body.boussole || {};

    // --- Nettoyage des entrées ---
    const safe = v => (typeof v === "string" && v.trim()) ? v.trim() : "—";
    const pick = o => ({ carte: safe(o?.carte), polarite: safe(o?.polarite) });

    const nord  = pick(b.nord);
    const sud   = pick(b.sud);
    const est   = pick(b.est);
    const ouest = pick(b.ouest);

    if (!nord.carte || !sud.carte || !est.carte || !ouest.carte) {
      return res.status(400).json({ error: "Boussole incomplète" });
    }

    const system = `
Tu es l'analyste officiel d'Oradia. Style clair, incarné, poétique sans ésotérisme.
Structure EXACTE :
1) NORD —
2) SUD —
3) EST —
4) OUEST —
5) SYNTHÈSE —
6) MANTRA —
7) QUESTION D’INTROSPECTION —
`.trim();

    const user = `
Intention: ${safe(body.intention)}
Boussole:
- NORD: ${nord.carte} (pol=${nord.polarite})
- SUD : ${sud.carte} (pol=${sud.polarite})
- EST : ${est.carte} (pol=${est.polarite})
- OUEST: ${ouest.carte} (pol=${ouest.polarite})
Mutations: ${JSON.stringify(body.mutations || [])}
`.trim();

    // DEBUG : vérifier que la clé est vue côté serveur
    console.log("API Key visible côté serveur ?", process.env.OPENAI_API_KEY ? "OK" : "ABSENTE");

    // --- Timeout (25s) ---
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 900,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      }),
      signal: ctrl.signal
    }).finally(() => clearTimeout(t));

    if (!r.ok) {
      const err = await r.text();
      console.error("[OpenAI ERROR]", err);
      return res.status(502).json({ error: "Analyse indisponible. Réessaie dans un instant." });
    }

    const data = await r.json();
    const texte = (data.choices?.[0]?.message?.content || "").trim();
    return res.status(200).json({ ok: true, texte });
  } catch (e) {
    console.error("Erreur serveur:", e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
