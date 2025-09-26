export const socialConfig = {
  facebook: {
    token: process.env.FACEBOOK_SECRET_KEY,
    pageId: process.env.FACEBOOK_PAGE_ID,
    baseUrl: "https://graph.facebook.com/v23.0",
  },
  linkedin: {
    baseUrl: "https://api.linkedin.com/rest/posts",
    organizationId: process.env.LINKEDIN_ORGANIZATION_ID,
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
  },
};

export const socialTemplates = [
  {
    hook: "❓ Otázka:",
    format: `{hook}
{question}

👨‍💼 Odpoveď experta:
{expertName}
{answerPreview}

📎 Čítať úplnú odpoveď experta:
{url}

`,
  },
  {
    hook: "🔥 Horúca otázka!",
    format: `{hook}

«{question}»

💡 {expertName} odpovedá:
{answerPreview}

👆 Kompletné riešenie na odkaze:
{url}

`,
  },
  {
    hook: "⚡ Expert odpovedal!",
    format: `{hook}

❓ {question}

✅ {expertName}:
«{answerPreview}»

🔗 Detaily tu: {url}

`,
  },
  {
    hook: "💬 Nová odpoveď na fóre",
    format: `{hook}

Otázka: {question}

Odpovedal: {expertName}
{answerPreview}

Čítať ďalej 👉 {url}

`,
  },
  {
    hook: "🎯 Riešenie nájdené!",
    format: `{hook}

"{question}"

{expertName} sa podelil o skúsenosti:
{answerPreview}

Úplná odpoveď: {url}

`,
  },
  {
    hook: "💡 Profesionálna rada",
    format: `{hook}

📋 {question}

🎓 Expert {expertName}:
{answerPreview}

▶️ Pozrieť úplnú odpoveď: {url}

`,
  },
  {
    hook: "✨ Čerstvá odpoveď experta!",
    format: `{hook}

🤔 Otázka: "{question}"

📝 {expertName} vysvetľuje:
{answerPreview}

🔍 Podrobnosti: {url}

`,
  },
  {
    hook: "🚀 Nové riešenie!",
    format: `{hook}

❓ {question}

👉 {expertName} dal podrobnú odpoveď:
{answerPreview}

💻 Čítať na stránke: {url}

`,
  },
  {
    hook: "📢 Exkluzívna konzultácia",
    format: `{hook}

"{question}"

🏆 Odpoveď od {expertName}:
{answerPreview}

📖 Plná verzia tu: {url}

`,
  },
  {
    hook: "⭐ Otázka dňa vyriešená!",
    format: `{hook}

💭 {question}

🎯 {expertName} odporúča:
{answerPreview}

👀 Dozvedieť sa viac: {url}

`,
  },
];
