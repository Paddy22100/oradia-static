// pages/api/analyse-tore.js
export const config = { runtime: "nodejs" };

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "https://oradia.fr");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY absente côté serveur" });
  }

  try {
    const body = req.body || {};
    const safe = v => (typeof v === "string" && v.trim()) ? v.trim() : "—";
    const sym = s => {
      if (!s || typeof s !== "string") return "—";
      const n = s.normalize("NFKD");
      if (n.includes("⚫") || /\u26AB/.test(n)) return "⚫";
      if (n.includes("🔺") || /\u25B2/.test(n) || /\u1F53A/.test(n)) return "🔺";
      return "—";
    };
    const norm = o => ({ carte: safe(o?.carte), polarite: sym(o?.polarite), piece: sym(o?.piece) });

    const fam = body.familles || {};
    const emotions       = norm(fam.emotions);
    const besoins        = norm(fam.besoins);
    const transmutation  = norm(fam.transmutation);
    const archetypes     = norm(fam.archetypes);
    const revelations    = norm(fam.revelations);
    const actions        = norm(fam.actions);
    const memoireCosmos  = safe(body?.memoireCosmos);
    const intention      = safe(body?.intention);

    if (!emotions.carte || !besoins.carte || !transmutation.carte || !archetypes.carte || !revelations.carte || !actions.carte) {
      return res.status(400).json({ error: "Familles incomplètes pour le Tore" });
    }

    const isPass = (polCarte, polPiece) => (polCarte !== "—" && polPiece !== "—" && polCarte !== polPiece);
    const passFlags = {
      emotions:      isPass(emotions.polarite,      emotions.piece),
      besoins:       isPass(besoins.polarite,       besoins.piece),
      transmutation: isPass(transmutation.polarite, transmutation.piece),
      archetypes:    isPass(archetypes.polarite,    archetypes.piece),
      revelations:   isPass(revelations.polarite,   revelations.piece),
      actions:       isPass(actions.polarite,       actions.piece),
    };

    // 1) L’IA ne renvoie que JSON passerelles + synthèse
    const SYSTEM = `
Tu rends uniquement un JSON valide et minimal, sans texte parasite ni balise de code.
Schéma exact:
{
  "passerelles": {
    "emotions": "string | ''",
    "besoins": "string | ''",
    "transmutation": "string | ''",
    "archetypes": "string | ''",
    "revelations": "string | ''",
    "actions": "string | ''"
  },
  "synthese": "string"
}

Règles d'écriture:
- Style Oradia: poétique, ancré, clair.
- Fournir une phrase courte pour chaque passerelle avec flag=true; renvoyer "" sinon.
- N'ajoute aucune autre clé. Pas de virgules finales.
`.trim();

    const USER = JSON.stringify({
      intention,
      familles: {
        emotions:      { nom: emotions.carte,      polarite: emotions.polarite,      piece: emotions.piece,      passerelle: passFlags.emotions },
        besoins:       { nom: besoins.carte,       polarite: besoins.polarite,       piece: besoins.piece,       passerelle: passFlags.besoins },
        transmutation: { nom: transmutation.carte, polarite: transmutation.polarite, piece: transmutation.piece, passerelle: passFlags.transmutation },
        archetypes:    { nom: archetypes.carte,    polarite: archetypes.polarite,    piece: archetypes.piece,    passerelle: passFlags.archetypes },
        revelations:   { nom: revelations.carte,   polarite: revelations.polarite,   piece: revelations.piece,   passerelle: passFlags.revelations },
        actions:       { nom: actions.carte,       polarite: actions.polarite,       piece: actions.piece,       passerelle: passFlags.actions }
      },
      memoireCosmos
    });

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
        temperature: 0.6,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: USER }
        ]
      }),
      signal: ctrl.signal
    }).finally(() => clearTimeout(t));

    if (!r.ok) {
      const err = await r.text();
      console.error("[OpenAI ERROR][tore]", err);
      return res.status(502).json({ error: "Analyse indisponible. Réessaie dans un instant." });
    }

    const data = await r.json();
    let payload;
    try { payload = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
    catch { payload = {}; }

    const P = payload?.passerelles || {};
    const synthese = (payload?.synthese || "").trim();

    // 2) Assemblage côté serveur
    const polText = s => s === "⚫" ? "⚫ = énergie féminine" : s === "🔺" ? "🔺 = énergie masculine" : null;
    const fmtLine = (label, nom, pol, passKey) => {
      const parts = [];
      parts.push(`${label} : ${nom}`);
      const ptxt = polText(pol);
      if (ptxt) parts[0] += ` (${ptxt})`;
      const pmsg = (P?.[passKey] || "").trim();
      if (passFlags[passKey] && pmsg) parts.push(`— carte passerelle : ${pmsg}`);
      return parts.join(" ");
    };

    const lignes = [
      fmtLine("Ligne 1 – ÉMOTIONS",       emotions.carte,      emotions.polarite,      "emotions"),
      fmtLine("Ligne 2 – BESOINS",        besoins.carte,       besoins.polarite,       "besoins"),
      fmtLine("Ligne 3 – TRANSMUTATIONS", transmutation.carte, transmutation.polarite, "transmutation"),
      fmtLine("Ligne 4 – ARCHÉTYPES",     archetypes.carte,    archetypes.polarite,    "archetypes"),
      fmtLine("Ligne 5 – RÉVÉLATIONS",    revelations.carte,   revelations.polarite,   "revelations"),
      fmtLine("Ligne 6 – ACTIONS",        actions.carte,       actions.polarite,       "actions"),
    ];

    const texte =
`Votre Tirage du Tore:
${lignes.join("\n")}
Carte Mémoires Cosmos :
${memoireCosmos}

Synthèse du tirage :
${synthese || "—"}`;

    return res.status(200).json({ ok: true, texte });
  } catch (e) {
    console.error("Erreur serveur [tore]:", e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
