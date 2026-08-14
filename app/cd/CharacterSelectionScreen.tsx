"use client";

import Icon from "./Icon";
import styles from "./CharacterSelectionScreen.module.css";

export interface SelectableCharacter {
  id: string;
  name: string;
  avatar: string;
  selected: boolean;
}

export default function CharacterSelectionScreen({
  backgroundImage,
  characters,
  onToggle,
  onAdd,
  onBack,
  onConfirm,
}: {
  backgroundImage: string;
  characters: SelectableCharacter[];
  onToggle?: (id: string) => void;
  onAdd?: () => void;
  onBack?: () => void;
  onConfirm?: () => void;
}) {
  const selectedCount = characters.filter((character) => character.selected).length;
  return (
    <main className={styles.screen}>
      <div className={styles.bg} style={{ backgroundImage: `url(${backgroundImage})` }} />
      <div className={styles.scrim} />
      <header className={styles.header}>
        <button className={styles.back} onClick={onBack} aria-label="Zpět"><Icon name="back-chevron" size={22} /></button>
        <div>
          <h1>Výběr postav</h1>
          <p>Kdo v pohádce vystupuje</p>
        </div>
      </header>
      <section className={styles.card}>
        <div className={styles.grid}>
          {characters.map((character) => (
            <button key={character.id} className={character.selected ? styles.tileSelected : styles.tile} onClick={() => onToggle?.(character.id)} aria-pressed={character.selected}>
              <span className={styles.avatarWrap}>
                <img src={character.avatar} alt="" className={styles.avatar} />
                {character.selected && <span className={styles.check}><Icon name="checkmark" size={15} /></span>}
              </span>
              <span>{character.name}</span>
            </button>
          ))}
          <button className={styles.addTile} onClick={onAdd}>
            <span className={styles.addCircle}><Icon name="plus" size={24} /></span>
            <span>Nová postava</span>
          </button>
        </div>
      </section>
      <footer className={styles.footer}>
        <p>{selectedCount ? `Vybráno: ${selectedCount}` : "Vyberte alespoň jednu postavu"}</p>
        <button className={styles.cta} disabled={!selectedCount} onClick={onConfirm}>Potvrdit postavy</button>
      </footer>
    </main>
  );
}
