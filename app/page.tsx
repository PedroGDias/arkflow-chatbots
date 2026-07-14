export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>WhatsApp Bot</h1>
      <p>
        This app has no UI — it&apos;s a webhook server. Point your WhatsApp
        Cloud API webhook at <code>/api/webhook</code>. See README.md for
        setup.
      </p>
    </main>
  );
}
