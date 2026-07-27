"use client";
import { useState } from "react";
import styles from "./StorySelectionScreen.module.css";

/**
 * Nickyho pohádky — story setup flow (world → story details → voice), plus the
 * "browse all stories" catalog and its detail view.
 * Drop /public/images/... illustrations for worlds, catalog covers and character avatars.
 * Fonts: Alegreya 700–800, Nunito 600–800.
 */

export interface WorldSummary {
  id: string;
  name: string;
  image?: string;
}
export interface CatalogStory {
  id: string;
  name: string;
  group: string;
  image: string;
  bigImage?: string;
  description?: string;
}
export interface CharacterSummary {
  id: string;
  name: string;
  subtitle?: string;
  description?: string;
  avatar: string;
  selected?: boolean;
}
export interface VoiceSummary {
  id: string;
  name: string;
  subtitle?: string;
  image: string;
}

export default function StorySelectionScreen({
  backgroundImage = "/images/bg-zrozeni.jpg",

  readyWorlds,
  ownWorlds,
  selectedWorldId,
  onSelectWorld,
  onCreateWorld,
  onStudyWorld,
  onAddWorldPhoto,
  worldPhotos = [],
  onRemoveWorldPhoto,

  catalog,
  localStoryEnabled = false,
  onToggleLocalStory,

  motif,
  onMotifChange,
  onGenerateMotif,

  characters,
  onToggleCharacter,
  onCreateCharacter,
  onUpdateCharacter,
  onAddCharacterPhoto,
  characterPhotoCount = 0,

  voices,
  premiumVoices = [],
  selectedVoiceId,
  onSelectVoice,
  onPlayVoiceSample,
  onUpgradePremiumVoice,

  length = 10,
  onLengthChange,

  onBack,
  onSubmit,
}: {
  backgroundImage?: string;
  readyWorlds: WorldSummary[];
  ownWorlds: WorldSummary[];
  selectedWorldId?: string;
  onSelectWorld?: (id: string) => void;
  onCreateWorld?: (data: { name: string; description: string; link: string }) => void;
  onStudyWorld?: (description: string) => Promise<string> | string | void;
  onAddWorldPhoto?: () => void;
  worldPhotos?: string[];
  onRemoveWorldPhoto?: (index: number) => void;

  catalog: CatalogStory[];
  localStoryEnabled?: boolean;
  onToggleLocalStory?: () => void;

  motif?: string;
  onMotifChange?: (value: string) => void;
  onGenerateMotif?: () => void;

  characters: CharacterSummary[];
  onToggleCharacter?: (id: string) => void;
  onCreateCharacter?: (data: { name: string; description: string }) => void;
  onUpdateCharacter?: (id: string, data: { name: string; description: string }) => void;
  onAddCharacterPhoto?: () => void;
  characterPhotoCount?: number;

  voices: VoiceSummary[];
  premiumVoices?: VoiceSummary[];
  selectedVoiceId?: string;
  onSelectVoice?: (id: string) => void;
  onPlayVoiceSample?: (id: string) => void;
  onUpgradePremiumVoice?: () => void;

  length?: number;
  onLengthChange?: (n: number) => void;

  onBack?: () => void;
  onSubmit?: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [localWorldId, setLocalWorldId] = useState(selectedWorldId ?? readyWorlds[0]?.id ?? ownWorlds[0]?.id);
  const worldId = selectedWorldId ?? localWorldId;
  const allWorlds = [...readyWorlds, ...ownWorlds];
  const activeWorld = allWorlds.find((w) => w.id === worldId);

  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogTab, setCatalogTab] = useState("Vše");
  const [detailId, setDetailId] = useState<string | null>(null);
  const groups = ["Vše", ...Array.from(new Set(catalog.map((c) => c.group)))];

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [localVoiceId, setLocalVoiceId] = useState(selectedVoiceId ?? voices[0]?.id);
  const activeVoiceId = selectedVoiceId ?? localVoiceId;
  const activeVoice = voices.find((v) => v.id === activeVoiceId) ?? voices[0];

  const [worldSheetOpen, setWorldSheetOpen] = useState(false);
  const [wName, setWName] = useState("");
  const [wDesc, setWDesc] = useState("");
  const [wLinkOpen, setWLinkOpen] = useState(false);
  const [wLink, setWLink] = useState("");
  const [wNote, setWNote] = useState<string | null>(null);
  const [wStudying, setWStudying] = useState(false);

  const [charSheetId, setCharSheetId] = useState<string | "new" | null>(null);
  const [charName, setCharName] = useState("");
  const [charDesc, setCharDesc] = useState("");
  const editingChar = charSheetId && charSheetId !== "new" ? characters.find((c) => c.id === charSheetId) : null;

  const [localMotif, setLocalMotif] = useState("");
  const motifValue = motif ?? localMotif;
  function setMotif(v: string) {
    setLocalMotif(v);
    onMotifChange?.(v);
  }

  const filteredCatalog = catalog.filter(
    (c) => (catalogTab === "Vše" || c.group === catalogTab) && (!catalogQuery || c.name.toLowerCase().includes(catalogQuery.toLowerCase()))
  );
  const detail = catalog.find((c) => c.id === detailId) ?? null;

  function pickWorld(id: string) {
    setLocalWorldId(id);
    onSelectWorld?.(id);
  }

  async function handleStudyWorld() {
    if (!onStudyWorld) return;
    setWStudying(true);
    const result = await onStudyWorld(wDesc);
    setWNote(typeof result === "string" ? result : "Svět nastudován.");
    setWStudying(false);
  }
  function closeWorldSheet() {
    setWorldSheetOpen(false);
    setWName("");
    setWDesc("");
    setWLink("");
    setWLinkOpen(false);
    setWNote(null);
  }
  function saveWorldSheet() {
    if (wName.trim()) onCreateWorld?.({ name: wName.trim(), description: wDesc.trim(), link: wLink.trim() });
    closeWorldSheet();
  }

  function openCharSheet(c: CharacterSummary | null) {
    setCharSheetId(c ? c.id : "new");
    setCharName(c?.name ?? "");
    setCharDesc(c?.description ?? "");
  }
  function closeCharSheet() {
    setCharSheetId(null);
  }
  function saveCharSheet() {
    if (charSheetId === "new") onCreateCharacter?.({ name: charName.trim(), description: charDesc.trim() });
    else if (charSheetId) onUpdateCharacter?.(charSheetId, { name: charName.trim(), description: charDesc.trim() });
    closeCharSheet();
  }

  function pickVoice(id: string) {
    setLocalVoiceId(id);
    onSelectVoice?.(id);
  }

  function headerBack() {
    if (detailId) return setDetailId(null);
    if (catalogOpen) return setCatalogOpen(false);
    if (voiceOpen) return setVoiceOpen(false);
    if (step === 2) return setStep(1);
    onBack?.();
  }

  const stepLabel = detailId
    ? "DETAIL POHÁDKY"
    : catalogOpen
    ? `VŠECHNY POHÁDKY · ${catalog.length}`
    : voiceOpen
    ? "VÝBĚR HLASU"
    : step === 1
    ? "KROK 1 ZE 2 · SVĚT"
    : "KROK 2 ZE 2 · POHÁDKA";

  return (
    <main className={styles.screen}>
      <div className={styles.bgLayer} style={{ backgroundImage: `url(${backgroundImage})` }} />
      <div className={styles.scrim} aria-hidden />

      <header className={styles.header}>
        <button className={styles.backBtn} onClick={headerBack} aria-label="Zpět">
          ‹
        </button>
        <h1 className={styles.title}>Výběr pohádky</h1>
        <div className={styles.stepLabel}>{stepLabel}</div>
      </header>

      <div className={styles.scroll}>
        {!catalogOpen && !voiceOpen && !detailId && step === 1 && (
          <div className={styles.stack}>
            <section className={styles.card}>
              <div className={styles.cardLabel}>PŘIPRAVENÉ SVĚTY</div>
              <div className={styles.roller}>
                <button className={styles.rollerTile} onClick={() => setCatalogOpen(true)}>
                  <span className={styles.rollerTileLabel}>Všechny pohádky</span>
                </button>
                {readyWorlds.map((w) => (
                  <button
                    key={w.id}
                    className={worldId === w.id ? styles.rollerTileActive : styles.rollerTile}
                    style={w.image ? { backgroundImage: `linear-gradient(180deg,rgba(16,8,36,0) 44%,rgba(16,8,36,.8)),url(${w.image})` } : undefined}
                    onClick={() => pickWorld(w.id)}
                  >
                    <span className={styles.rollerTileLabel}>{w.name}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.card}>
              <div className={styles.cardLabel}>VLASTNÍ SVĚTY</div>
              <div className={styles.roller}>
                {ownWorlds.map((w) => (
                  <button
                    key={w.id}
                    className={worldId === w.id ? styles.rollerTileActive : styles.rollerTile}
                    style={w.image ? { backgroundImage: `linear-gradient(180deg,rgba(16,8,36,0) 44%,rgba(16,8,36,.8)),url(${w.image})` } : undefined}
                    onClick={() => pickWorld(w.id)}
                  >
                    <span className={styles.rollerTileLabel}>{w.name}</span>
                  </button>
                ))}
                <button className={styles.rollerTileDashed} onClick={() => setWorldSheetOpen(true)}>
                  ＋<span className={styles.rollerTileLabel}>Vlastní svět</span>
                </button>
              </div>
            </section>

            <section className={styles.card}>
              <button className={localStoryEnabled ? styles.pillOn : styles.pillOff} onClick={onToggleLocalStory}>
                <span className={styles.discIcon}>
                  <PinIcon />
                </span>
                <span>Pohádka podle mé polohy</span>
              </button>
              <div className={styles.hint}>
                {localStoryEnabled
                  ? "Pohádka se propojí s vaším okolím i s vybraným světem výše."
                  : "Můžete zapnout i společně s vybraným světem — děj se pak odehraje ve vašem okolí."}
              </div>
            </section>
          </div>
        )}

        {!catalogOpen && !voiceOpen && !detailId && step === 2 && (
          <div className={styles.stack}>
            <button className={styles.summaryRow} onClick={() => setStep(1)}>
              <span className={styles.summaryThumb} style={activeWorld?.image ? { backgroundImage: `url(${activeWorld.image})` } : undefined} />
              <span className={styles.summaryText}>
                <span className={styles.summaryLabel}>SVĚT POHÁDKY</span>
                <span className={styles.summaryValue}>{activeWorld?.name ?? "Nevybráno"}</span>
              </span>
              <span className={styles.chevronRight}>›</span>
            </button>

            <section className={styles.card}>
              <div className={styles.cardTitle}>Motiv pohádky</div>
              <textarea
                className={styles.textarea}
                rows={3}
                value={motifValue}
                onChange={(e) => setMotif(e.target.value)}
                placeholder="O čem by pohádka měla být… ✏️"
              />
              {onGenerateMotif && (
                <button className={styles.secondaryBtn} onClick={onGenerateMotif}>
                  <span className={styles.discIcon}>
                    <SparkleIcon />
                  </span>
                  Vymysli námět
                </button>
              )}
            </section>

            <section className={styles.card}>
              <div className={styles.cardTitle}>Kdo v pohádce vystupuje</div>
              <div className={styles.avatarRow}>
                {characters.map((c) => (
                  <button key={c.id} className={styles.avatarBtn} onClick={() => openCharSheet(c)} aria-label={c.name}>
                    <span className={styles.avatarWrap}>
                      <span
                        className={c.selected ? styles.avatarActive : styles.avatarImg}
                        style={{ backgroundImage: `url(${c.avatar})` }}
                      />
                      {c.selected && <span className={styles.selBadge}>✓</span>}
                    </span>
                    <span className={styles.avatarName}>{c.name}</span>
                  </button>
                ))}
                <button className={styles.avatarBtn} onClick={() => openCharSheet(null)} aria-label="Přidat postavu">
                  <span className={styles.avatarAdd}>
                    <PlusIcon />
                  </span>
                  <span className={styles.avatarName}>Přidat</span>
                </button>
              </div>
            </section>

            <button className={styles.summaryRow} onClick={() => setVoiceOpen(true)}>
              {activeVoice && <span className={styles.summaryThumb} style={{ backgroundImage: `url(${activeVoice.image})`, borderRadius: "50%" }} />}
              <span className={styles.summaryText}>
                <span className={styles.summaryLabel}>VYPRÁVÍ</span>
                <span className={styles.summaryValue}>{activeVoice?.name ?? "Nevybráno"}</span>
                <span className={styles.summarySub}>{activeVoice?.subtitle}</span>
              </span>
              <span className={styles.chevronRight}>›</span>
            </button>

            <section className={styles.card}>
              <div className={styles.cardTitle}>Délka pohádky</div>
              <div className={styles.sliderRow}>
                <input
                  className={styles.range}
                  type="range"
                  min={2}
                  max={18}
                  value={length}
                  onChange={(e) => onLengthChange?.(+e.target.value)}
                />
                <span className={styles.sliderValue}>{length} scén</span>
              </div>
            </section>
          </div>
        )}

        {!detailId && catalogOpen && (
          <div className={styles.stack}>
            <input
              className={styles.searchInput}
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              placeholder="Hledat pohádku…"
            />
            <div className={styles.tabs}>
              {groups.map((g) => (
                <button key={g} className={catalogTab === g ? styles.tabOn : styles.tabOff} onClick={() => setCatalogTab(g)}>
                  {g}
                </button>
              ))}
            </div>
            <div className={styles.grid}>
              {filteredCatalog.map((c) => (
                <button
                  key={c.id}
                  className={styles.gridTile}
                  style={{ backgroundImage: `linear-gradient(180deg,rgba(16,8,36,0) 40%,rgba(16,8,36,.84)),url(${c.image})` }}
                  onClick={() => setDetailId(c.id)}
                >
                  <span className={styles.gridTileLabel}>{c.name}</span>
                </button>
              ))}
            </div>
            <div className={styles.catalogCount}>
              {filteredCatalog.length} {filteredCatalog.length === 1 ? "pohádka" : filteredCatalog.length < 5 ? "pohádky" : "pohádek"}
            </div>
          </div>
        )}

        {voiceOpen && (
          <div className={styles.stack}>
            <section className={styles.card}>
              <div className={styles.voiceHero}>
                {activeVoice && <span className={styles.voiceHeroAvatar} style={{ backgroundImage: `url(${activeVoice.image})` }} />}
              </div>
              {activeVoice && (
                <>
                  <div className={styles.voiceHeroName}>{activeVoice.name}</div>
                  <div className={styles.voiceHeroSub}>{activeVoice.subtitle}</div>
                </>
              )}
              <button className={styles.sampleBtn} onClick={() => activeVoice && onPlayVoiceSample?.(activeVoice.id)} aria-label="Přehrát ukázku">
                <PlayIcon />
              </button>
              <div className={styles.sampleLabel}>Přehrát ukázku</div>
            </section>

            <div className={styles.cardTitle}>Vypravěči</div>
            <div className={styles.avatarRow}>
              {voices.map((v) => (
                <button key={v.id} className={styles.avatarBtn} onClick={() => pickVoice(v.id)} aria-label={v.name}>
                  <span className={v.id === activeVoiceId ? styles.avatarActive : styles.avatarImg} style={{ backgroundImage: `url(${v.image})` }} />
                  <span className={styles.avatarName}>{v.name}</span>
                </button>
              ))}
            </div>

            {premiumVoices.length > 0 && (
              <>
                <div className={styles.premiumHeader}>
                  <span className={styles.cardTitle}>Premium hlasy</span>
                  <span className={styles.premiumBadge}>★ PREMIUM</span>
                </div>
                <div className={styles.rowSpread}>
                  {premiumVoices.map((v) => (
                    <button key={v.id} className={styles.avatarBtn} onClick={onUpgradePremiumVoice} aria-label={v.name}>
                      <span className={styles.avatarWrap}>
                        <span className={styles.avatarLocked} style={{ backgroundImage: `url(${v.image})` }} />
                        <span className={styles.lockBadge}>🔒</span>
                      </span>
                      <span className={styles.avatarName}>{v.name}</span>
                    </button>
                  ))}
                </div>
                <div className={styles.hint}>Klon hlasu mámy či táty a další hlasy odemknete v Premium.</div>
              </>
            )}

            <button className={styles.cta} onClick={() => setVoiceOpen(false)}>
              <span className={styles.discIcon}>
                <PlayIcon small />
              </span>
              Vybrat tento hlas
            </button>
          </div>
        )}
      </div>

      {!catalogOpen && !voiceOpen && !detailId && (
        <div className={styles.footer}>
          {step === 1 ? (
            <button className={styles.cta} onClick={() => setStep(2)}>
              Pokračovat
            </button>
          ) : (
            <button className={styles.cta} onClick={onSubmit}>
              <span className={styles.discIcon}>
                <PlayIcon small />
              </span>
              Vytvořit pohádku
            </button>
          )}
        </div>
      )}

      {detail && (
        <div className={styles.detailOverlay}>
          <div className={styles.detailBg} style={{ backgroundImage: `url(${detail.bigImage ?? detail.image})` }} />
          <div className={styles.detailScrim} />
          <button className={styles.detailNavLeft} onClick={() => {
            const l = filteredCatalog; const i = l.findIndex((c) => c.id === detailId);
            if (i >= 0) setDetailId(l[(i - 1 + l.length) % l.length].id);
          }} aria-label="Předchozí pohádka">‹</button>
          <button className={styles.detailNavRight} onClick={() => {
            const l = filteredCatalog; const i = l.findIndex((c) => c.id === detailId);
            if (i >= 0) setDetailId(l[(i + 1) % l.length].id);
          }} aria-label="Další pohádka">›</button>
          <div className={styles.detailCard}>
            <h2 className={styles.detailName}>{detail.name}</h2>
            {detail.description && <p className={styles.detailDesc}>{detail.description}</p>}
            <button
              className={styles.cta}
              onClick={() => {
                pickWorld("k:" + detail.id);
                setDetailId(null);
                setCatalogOpen(false);
              }}
            >
              Vybrat tuto pohádku
            </button>
          </div>
        </div>
      )}

      {worldSheetOpen && (
        <div className={styles.sheetOverlay}>
          <div className={styles.sheetBackdrop} onClick={closeWorldSheet} />
          <div className={styles.sheet}>
            <div className={styles.sheetHeaderRow}>
              <button className={styles.sheetBackBtn} onClick={closeWorldSheet} aria-label="Zpět">‹</button>
              <div className={styles.sheetTitle}>Vytvořit vlastní svět</div>
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>NÁZEV SVĚTA</span>
              <input className={styles.input} value={wName} onChange={(e) => setWName(e.target.value)} placeholder="Pojmenuj svůj svět…" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>POPIS SVĚTA</span>
              <textarea
                className={styles.textarea}
                rows={4}
                value={wDesc}
                onChange={(e) => setWDesc(e.target.value)}
                placeholder="Jak svět vypadá, kdo v něm žije, co se v něm děje…"
              />
            </label>
            {onAddWorldPhoto && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>FOTKY ({worldPhotos.length} / 5)</span>
                <div className={styles.photoGrid}>
                  {worldPhotos.map((src, i) => (
                    <div key={i} className={styles.photoThumb} style={{ backgroundImage: `url(${src})` }}>
                      <button className={styles.photoDelete} onClick={() => onRemoveWorldPhoto?.(i)} aria-label="Smazat fotku">×</button>
                    </div>
                  ))}
                  {worldPhotos.length < 5 && (
                    <button className={styles.photoAdd} onClick={onAddWorldPhoto} aria-label="Přidat fotku">
                      <PlusIcon />
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className={styles.row2}>
              <button className={wLinkOpen ? styles.secondaryBtnOn : styles.secondaryBtn} onClick={() => setWLinkOpen((v) => !v)}>
                <span className={styles.discIcon}><LinkIcon /></span>Odkaz
              </button>
              {onStudyWorld && (
                <button className={styles.secondaryBtn} onClick={handleStudyWorld} disabled={wStudying}>
                  <span className={styles.discIcon}><SearchIcon /></span>{wStudying ? "Studuji…" : "Prostudovat"}
                </button>
              )}
            </div>
            {wLinkOpen && (
              <input className={styles.input} value={wLink} onChange={(e) => setWLink(e.target.value)} placeholder="https://…" />
            )}
            {wNote && <div className={styles.note}>{wNote}</div>}
            <div className={styles.sheetActions}>
              <button className={styles.cta} onClick={saveWorldSheet}>Uložit svět</button>
              <button className={styles.cancelBtn} onClick={closeWorldSheet}>Zrušit</button>
            </div>
          </div>
        </div>
      )}

      {charSheetId && (
        <div className={styles.sheetOverlay}>
          <div className={styles.sheetBackdrop} onClick={closeCharSheet} />
          <div className={styles.sheet}>
            <div className={styles.sheetHeaderRow}>
              <button className={styles.sheetBackBtn} onClick={closeCharSheet} aria-label="Zpět">‹</button>
              {editingChar && <span className={styles.summaryThumb} style={{ backgroundImage: `url(${editingChar.avatar})`, borderRadius: "50%", width: 48, height: 48 }} />}
              <div className={styles.sheetHeaderText}>
                <div className={styles.sheetTitle}>{charSheetId === "new" ? "Nová postava" : editingChar?.name}</div>
                <div className={styles.sheetSubtitle}>{charSheetId === "new" ? "Vlastní postava do pohádek" : editingChar?.subtitle}</div>
              </div>
            </div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>JMÉNO *</span>
              <input className={styles.input} value={charName} onChange={(e) => setCharName(e.target.value)} placeholder="Kubík, Pohádková víla, Dráček…" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>POPIS (NEPOVINNÉ)</span>
              <textarea
                className={styles.textarea}
                rows={4}
                value={charDesc}
                onChange={(e) => setCharDesc(e.target.value)}
                placeholder="Malý hnědý medvídek s červenou mašlí…"
              />
            </label>
            {onAddCharacterPhoto && (
              <button className={styles.secondaryBtn} onClick={onAddCharacterPhoto}>
                <span className={styles.discIcon}><CameraIcon /></span>Nahrát fotku ({characterPhotoCount}/5)
              </button>
            )}
            {editingChar && (
              <button className={styles.secondaryBtnOn} onClick={() => onToggleCharacter?.(editingChar.id)}>
                {editingChar.selected ? "✓ V pohádce" : "Přidat do pohádky"}
              </button>
            )}
            <div className={styles.sheetActions}>
              <button className={styles.cta} onClick={saveCharSheet}>
                {charSheetId === "new" ? "Přidat postavu" : "Uložit"}
              </button>
              <button className={styles.cancelBtn} onClick={closeCharSheet}>Zrušit</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 3l1.8 4.9L18 9l-4.2 1.9L12 16l-1.8-5L6 9l4.2-1.1L12 3Z" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 14.5l5-5" />
      <path d="M12.5 7.5l1.6-1.6a3.6 3.6 0 0 1 5 5L17.5 12.5" />
      <path d="M11.5 16.5l-1.6 1.6a3.6 3.6 0 0 1-5-5L6.5 11.5" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="6.2" />
      <path d="M15.6 15.6L20 20" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8.5h4l1.6-2h6.8l1.6 2H21v10H3z" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}
function PlayIcon({ small }: { small?: boolean }) {
  const s = small ? 15 : 26;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" />
    </svg>
  );
}
