// 🔒 Zásady ochrany soukromí — základní verze. NENÍ právně posouzeno
// právníkem, doplňte prosím [Doplnit: ...] místa skutečnými údaji
// (provozovatel, kontakt) a nechte text zkontrolovat před ostrým použitím.

export const metadata = {
  title: "Zásady ochrany soukromí — Nickyho pohádky",
};

export default function PrivacyPage() {
  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "2.5rem 1.25rem 4rem",
        color: "#fff",
        lineHeight: 1.6,
        position: "relative",
        zIndex: 1,
      }}
    >
      <h1 style={{ fontSize: "1.6rem", fontWeight: 800, marginBottom: "0.3rem" }}>
        Zásady ochrany soukromí
      </h1>
      <p style={{ opacity: 0.7, fontSize: "0.9rem", marginBottom: "2rem" }}>
        Platí od [Doplnit: datum]. Provozovatel: [Doplnit: název a IČO], kontakt: [Doplnit: e-mail].
      </p>

      <h2 style={h2}>Co appka zpracovává</h2>
      <ul style={ul}>
        <li>Jména a popisy postav, které do pohádky zadáte (vč. postav vytvořených podle vaší rodiny).</li>
        <li>Fotografie postav, které nahrajete — používají se jako vizuální reference pro ilustrace.</li>
        <li>Hlasové nahrávky pro klonování hlasu — <strong>zvláštní kategorie údajů (biometrický údaj)</strong>, viz níže.</li>
        <li>Vygenerované pohádky, obrázky a namluvení, historie pohádek.</li>
        <li>Technické identifikátory zařízení/účtu pro synchronizaci mezi zařízeními (jméno a heslo, žádný e-mail).</li>
      </ul>

      <h2 style={h2}>Klonování hlasu — biometrický údaj</h2>
      <p>
        Appka umožňuje vytvořit AI klon hlasu člena rodiny (vč. dítěte) pro namluvení pohádek. Hlasová
        nahrávka se považuje za biometrický osobní údaj. Nahrávku appka sama neukládá — je odeslána
        přímo poskytovateli ElevenLabs, který z ní vytvoří hlasový model. Klonovaný hlas můžete kdykoliv
        jedním ťuknutím smazat (smaže se i u ElevenLabs).
      </p>
      <p>
        Tuhle funkci smí použít pouze rodič nebo zákonný zástupce nahrávané osoby, a to jen s jejím
        souhlasem (u dítěte v jeho zastoupení). Appka si před prvním nahráním vyžádá výslovné potvrzení
        tohoto souhlasu.
      </p>

      <h2 style={h2}>Kdo data dále zpracovává (subdodavatelé)</h2>
      <ul style={ul}>
        <li><strong>Anthropic (Claude)</strong> — generování textu pohádky.</li>
        <li><strong>Google (Gemini)</strong> — generování ilustrací a (u některých hlasů) namluvení.</li>
        <li><strong>ElevenLabs</strong> — namluvení a klonování hlasu.</li>
        <li><strong>Vercel</strong> — hosting appky a dočasné úložiště pohádek/nastavení.</li>
      </ul>
      <p>Žádný z těchto poskytovatelů nedostává data pro reklamu ani je neprodává třetím stranám.</p>

      <h2 style={h2}>Děti a appka</h2>
      <p>
        Appka je určena k používání rodičem/dospělým jménem dítěte, ne k přímému samostatnému používání
        dítětem bez dohledu. Appka nezobrazuje reklamy a neprovádí marketingové sledování zaměřené na děti.
      </p>

      <h2 style={h2}>Uchovávání a smazání dat</h2>
      <p>
        Historie pohádek, postavy a nastavení se primárně ukládají ve vašem prohlížeči/zařízení.
        Máte-li appku propojenou s účtem, tyto texty (ne obrázky/zvuk) se synchronizují mezi vašimi
        zařízeními. Smazání konkrétní pohádky/postavy/klonovaného hlasu jde provést přímo v appce.
        Pro úplné smazání účtu a všech dat napište na [Doplnit: e-mail].
      </p>

      <h2 style={h2}>Kontakt</h2>
      <p>Dotazy k ochraně soukromí: [Doplnit: e-mail].</p>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: "1.15rem", fontWeight: 800, marginTop: "1.8rem", marginBottom: "0.5rem" };
const ul: React.CSSProperties = { paddingLeft: "1.2rem", marginBottom: "1rem" };
