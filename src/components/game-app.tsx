"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { io, type Socket } from "socket.io-client";
import type { Difficulty, GameSnapshot, PlayerIdentity } from "@/lib/game/types";

type Account = { id: string; name?: string | null; email?: string | null } | null;
type View = "home" | "auth" | "leaderboard" | "profile" | "game";
type Ack = { ok: boolean; message?: string; snapshot?: GameSnapshot };

const DIFFICULTIES: Array<{ value: Difficulty; label: string; time: string }> = [
  { value: "easy", label: "Kolay", time: "60 sn" },
  { value: "medium", label: "Orta", time: "40 sn" },
  { value: "hard", label: "Zor", time: "20 sn" },
];

export function GameApp({ account }: { account: Account }) {
  const [view, setView] = useState<View>("home");
  const [displayName, setDisplayName] = useState(account?.name ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const [roomCode, setRoomCode] = useState("");
  const [identity, setIdentity] = useState<PlayerIdentity | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const connect = useCallback(async (): Promise<Socket> => {
    if (socketRef.current?.connected) return socketRef.current;
    const response = await fetch("/api/player/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: account ? undefined : displayName }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Oyuncu oturumu açılamadı.");
    setIdentity(data.identity);
    const socket = io({ auth: { token: data.token }, transports: ["websocket", "polling"] });
    socket.on("game:state", (state: GameSnapshot) => {
      setSnapshot(state);
      setView("game");
      localStorage.setItem("kelime-active-game", state.id);
    });
    socket.on("connect", () => {
      const activeGame = localStorage.getItem("kelime-active-game");
      if (activeGame) socket.emit("game:reconnect", { gameId: activeGame }, () => undefined);
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", (error) => reject(error));
    });
    socketRef.current = socket;
    const previousGame = localStorage.getItem("kelime-active-game");
    if (previousGame) {
      socket.emit("game:reconnect", { gameId: previousGame }, (result: Ack) => {
        if (result.ok && result.snapshot) {
          setSnapshot(result.snapshot);
          setView("game");
        } else localStorage.removeItem("kelime-active-game");
      });
    }
    return socket;
  }, [account, displayName]);

  useEffect(
    () => () => {
      socketRef.current?.disconnect();
    },
    [],
  );

  const runCommand = async (event: string, payload: unknown = {}) => {
    setBusy(true);
    setMessage("");
    try {
      const socket = await connect();
      const result = await new Promise<Ack>((resolve) => socket.emit(event, payload, resolve));
      if (!result.ok) throw new Error(result.message ?? "İşlem tamamlanamadı.");
      if (result.snapshot) {
        setSnapshot(result.snapshot);
        setView("game");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bir hata oluştu.");
    } finally {
      setBusy(false);
    }
  };

  const playerNameValid = Boolean(account || displayName.trim().length >= 2);

  if (view === "auth") return <AuthPanel onBack={() => setView("home")} />;
  if (view === "leaderboard") return <Leaderboard onBack={() => setView("home")} />;
  if (view === "profile") return <Profile account={account} onBack={() => setView("home")} />;
  if (view === "game" && snapshot && identity) {
    return (
      <GameBoard
        snapshot={snapshot}
        identity={identity}
        message={message}
        busy={busy}
        command={runCommand}
        onExit={() => {
          localStorage.removeItem("kelime-active-game");
          setSnapshot(null);
          setView("home");
        }}
      />
    );
  }

  return (
    <main className="shell">
      <nav className="nav">
        <button className="brand" onClick={() => setView("home")}>
          <span>K</span> Kelime Oyunu
        </button>
        <div className="navActions">
          <button className="textButton" onClick={() => setView("leaderboard")}>
            Liderlik
          </button>
          {account ? (
            <>
              <button className="textButton" onClick={() => setView("profile")}>
                {account.name}
              </button>
              <button className="outline small" onClick={() => signOut()}>
                Çıkış
              </button>
            </>
          ) : (
            <button className="outline small" onClick={() => setView("auth")}>
              Giriş / Kayıt
            </button>
          )}
        </div>
      </nav>

      <section className="hero">
        <div className="eyebrow">TÜRKÇE KELİME ZİNCİRİ</div>
        <h1>
          İkinci harf,
          <br />
          <em>sıradaki hamle.</em>
        </h1>
        <p>
          Hızlı düşün, doğru kelimeyi bul, puanını yükselt. Tek başına rekor kır veya bir arkadaşına
          meydan oku.
        </p>
      </section>

      <section className="setupCard">
        {!account && (
          <label className="field wide">
            <span>Oyuncu adın</span>
            <input
              value={displayName}
              maxLength={30}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Adını yaz"
            />
          </label>
        )}
        <div className="field wide">
          <span>Zorluk</span>
          <div className="segmented">
            {DIFFICULTIES.map((item) => (
              <button
                key={item.value}
                className={difficulty === item.value ? "active" : ""}
                onClick={() => setDifficulty(item.value)}
              >
                {item.label}
                <small>{item.time}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="modeGrid">
          <button
            className="modeCard solo"
            disabled={!playerNameValid || busy}
            onClick={() => runCommand("game:createSolo", { difficulty })}
          >
            <span className="modeIcon">↗</span>
            <strong>Tek Oyuncu</strong>
            <small>Zamana karşı zinciri uzat</small>
            <b>Başla →</b>
          </button>
          <button
            className="modeCard multi"
            disabled={!playerNameValid || busy}
            onClick={() => runCommand("room:create", { difficulty })}
          >
            <span className="modeIcon">↔</span>
            <strong>Özel Oda Kur</strong>
            <small>Oda kodunu arkadaşınla paylaş</small>
            <b>Oda oluştur →</b>
          </button>
        </div>
        <div className="joinRow">
          <span>Bir oda kodun mu var?</span>
          <input
            aria-label="Oda kodu"
            value={roomCode}
            maxLength={6}
            onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
            placeholder="ABC123"
          />
          <button
            className="dark"
            disabled={!playerNameValid || roomCode.length !== 6 || busy}
            onClick={() => runCommand("room:join", { roomCode })}
          >
            Katıl
          </button>
        </div>
        {message && (
          <p className="error" role="alert">
            {message}
          </p>
        )}
      </section>

      <section className="rules">
        <article>
          <b>01</b>
          <h3>Kelimeyi bul</h3>
          <p>Yeni kelime, öncekinin ikinci harfiyle başlamalı.</p>
        </article>
        <article>
          <b>02</b>
          <h3>Hızlı davran</h3>
          <p>Kalan süre ve zorluk, kazandığın puanı belirler.</p>
        </article>
        <article>
          <b>03</b>
          <h3>Zinciri bozma</h3>
          <p>Süre dolarsa solo koşun veya karşılaşma sona erer.</p>
        </article>
      </section>
    </main>
  );
}

function GameBoard({
  snapshot,
  identity,
  message,
  busy,
  command,
  onExit,
}: {
  snapshot: GameSnapshot;
  identity: PlayerIdentity;
  message: string;
  busy: boolean;
  command: (event: string, payload?: unknown) => Promise<void>;
  onExit: () => void;
}) {
  const [word, setWord] = useState("");
  const [now, setNow] = useState(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => inputRef.current?.focus(), [snapshot.activePlayerKey, snapshot.words.length]);
  const me = snapshot.players.find((player) => player.playerKey === identity.playerKey);
  const myTurn = snapshot.activePlayerKey === identity.playerKey;
  const targetDeadline = snapshot.pauseDeadline ?? snapshot.reconnectDeadline ?? snapshot.deadline;
  const seconds = targetDeadline ? Math.max(0, Math.ceil((targetDeadline - now) / 1000)) : 0;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!word.trim()) return;
    await command("word:submit", { word, commandId: crypto.randomUUID() });
    setWord("");
  };

  if (snapshot.status === "ended") {
    const won = snapshot.winnerKey === identity.playerKey;
    return (
      <main className="gameShell resultPage">
        <div className="resultMark">{snapshot.mode === "solo" ? "★" : won ? "✓" : "×"}</div>
        <div className="eyebrow">OYUN TAMAMLANDI</div>
        <h1>{snapshot.mode === "solo" ? "Koşu sona erdi" : won ? "Kazandın!" : "Bu kez olmadı"}</h1>
        <p>
          {snapshot.endReason === "timeout"
            ? "Süre doldu."
            : snapshot.endReason === "disconnect"
              ? "Bağlantı süresi doldu."
              : "Oyuncu karşılaşmadan ayrıldı."}
        </p>
        <div className="resultScores">
          {snapshot.players.map((player) => (
            <div key={player.playerKey}>
              <span>{player.displayName}</span>
              <strong>{player.score}</strong>
              <small>
                puan · {snapshot.words.filter((item) => item.playerKey === player.playerKey).length}{" "}
                kelime
              </small>
            </div>
          ))}
        </div>
        <button className="primary" onClick={onExit}>
          Ana sayfaya dön
        </button>
      </main>
    );
  }

  return (
    <main className="gameShell">
      <header className="gameHeader">
        <button className="brand" onClick={() => command("game:forfeit")}>
          <span>K</span> Kelime Oyunu
        </button>
        <div>
          {snapshot.roomCode && <span className="roomBadge">ODA {snapshot.roomCode}</span>}{" "}
          <span className="difficultyBadge">{snapshot.difficulty.toLocaleUpperCase("tr-TR")}</span>
        </div>
      </header>
      <section className="scoreBoard">
        {snapshot.players.map((player) => (
          <article
            key={player.playerKey}
            className={snapshot.activePlayerKey === player.playerKey ? "current" : ""}
          >
            <div className="avatar">{player.displayName[0].toLocaleUpperCase("tr-TR")}</div>
            <div>
              <strong>
                {player.displayName}
                {player.playerKey === identity.playerKey && " (Sen)"}
              </strong>
              <small>{player.connected ? "Bağlı" : "Bağlantı kesildi"}</small>
            </div>
            <b>
              {player.score}
              <small> PUAN</small>
            </b>
          </article>
        ))}
        {snapshot.mode === "multiplayer" && snapshot.players.length === 1 && (
          <article className="waiting">
            <span>•••</span>
            <div>
              <strong>Rakip bekleniyor</strong>
              <small>Kodu arkadaşınla paylaş</small>
            </div>
          </article>
        )}
      </section>

      {snapshot.status === "waiting" ? (
        <section className="waitingPanel">
          <div className="pulse">{snapshot.roomCode}</div>
          <h2>Arkadaşını bekliyoruz</h2>
          <p>Bu oda kodunu paylaş. İkinci oyuncu katıldığında karşılaşmayı başlatabilirsin.</p>
          <button
            className="primary"
            disabled={
              snapshot.players.length < 2 || identity.playerKey !== snapshot.players[0]?.playerKey
            }
            onClick={() => command("game:start")}
          >
            Karşılaşmayı başlat
          </button>
        </section>
      ) : (
        <section className="playArea">
          <div className={`timer ${seconds <= 5 ? "danger" : ""}`}>
            <span>{seconds}</span>
            <small>SANİYE</small>
          </div>
          <div className="turnLabel">
            {snapshot.status === "paused"
              ? "OYUN DURAKLATILDI"
              : snapshot.status === "reconnecting"
                ? "OYUNCU YENİDEN BAĞLANIYOR"
                : myTurn
                  ? "SIRA SENDE"
                  : "RAKİBİN SIRASI"}
          </div>
          {snapshot.requiredLetter ? (
            <h2>
              <em>{snapshot.requiredLetter.toLocaleUpperCase("tr-TR")}</em> ile başlayan bir kelime
            </h2>
          ) : (
            <h2>Zinciri başlatacak bir kelime</h2>
          )}
          <form onSubmit={submit} className="wordForm">
            <input
              ref={inputRef}
              value={word}
              onChange={(event) => setWord(event.target.value)}
              disabled={!myTurn || snapshot.status !== "playing" || busy}
              placeholder={myTurn ? "Kelimeyi yaz…" : "Rakibin kelimesi bekleniyor…"}
              autoComplete="off"
            />
            <button className="primary" disabled={!myTurn || snapshot.status !== "playing" || busy}>
              Gönder ↵
            </button>
          </form>
          {message && (
            <p className="error" role="alert">
              {message}
            </p>
          )}
          <button
            className="pauseButton"
            disabled={
              !myTurn ||
              snapshot.status === "reconnecting" ||
              Boolean(me?.pauseUsed && snapshot.status !== "paused")
            }
            onClick={() => command(snapshot.status === "paused" ? "pause:resume" : "pause:start")}
          >
            {snapshot.status === "paused"
              ? "▶ Devam et"
              : `Ⅱ Duraklat ${me?.pauseUsed ? "(kullanıldı)" : "(1 hak · maks. 30 sn · −5/sn)"}`}
          </button>
        </section>
      )}

      <section className="wordHistory">
        <h3>
          Kelime zinciri <span>{snapshot.words.length} kelime</span>
        </h3>
        <div>
          {snapshot.words.length ? (
            snapshot.words.map((item) => (
              <span key={item.turnNumber}>
                {item.word}
                <small>+{item.points}</small>
              </span>
            ))
          ) : (
            <p>İlk kelime henüz girilmedi.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function AuthPanel({ onBack }: { onBack: () => void }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    if (register) {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, displayName: form.get("displayName") }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error);
        setBusy(false);
        return;
      }
    }
    const result = await signIn("credentials", { email, password, redirect: false });
    if (result?.error) {
      setError("E-posta veya şifre hatalı.");
      setBusy(false);
      return;
    }
    location.href = "/";
  };
  return (
    <main className="centerPage">
      <button className="back" onClick={onBack}>
        ← Geri
      </button>
      <form className="authCard" onSubmit={submit}>
        <div className="brandMark">K</div>
        <h1>{register ? "Hesap oluştur" : "Tekrar hoş geldin"}</h1>
        <p>Puanlarını kaydet ve liderlik tablosuna gir.</p>
        {register && (
          <label>
            <span>Oyuncu adı</span>
            <input name="displayName" minLength={2} maxLength={30} required />
          </label>
        )}
        <label>
          <span>E-posta</span>
          <input type="email" name="email" required />
        </label>
        <label>
          <span>Şifre</span>
          <input type="password" name="password" minLength={8} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Bekleyin…" : register ? "Kayıt ol" : "Giriş yap"}
        </button>
        <button type="button" className="textButton" onClick={() => setRegister(!register)}>
          {register ? "Zaten hesabın var mı? Giriş yap" : "Hesabın yok mu? Kayıt ol"}
        </button>
      </form>
    </main>
  );
}

function Leaderboard({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState("solo");
  const [difficulty, setDifficulty] = useState("easy");
  const [period, setPeriod] = useState("daily");
  const [rows, setRows] = useState<
    Array<{ rank: number; displayName: string; score: number; achievedAt: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(`/api/leaderboards?mode=${mode}&difficulty=${difficulty}&period=${period}`)
      .then((r) => r.json())
      .then((data) => setRows(data.leaderboard ?? []))
      .finally(() => setLoading(false));
  }, [mode, difficulty, period]);
  return (
    <main className="contentPage">
      <button className="back" onClick={onBack}>
        ← Ana sayfa
      </button>
      <div className="eyebrow">EN İYİ OYUNCULAR</div>
      <h1>Liderlik tablosu</h1>
      <div className="filters">
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="solo">Tek oyuncu</option>
          <option value="multiplayer">Çok oyunculu</option>
        </select>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="easy">Kolay</option>
          <option value="medium">Orta</option>
          <option value="hard">Zor</option>
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          <option value="daily">Günlük</option>
          <option value="weekly">Haftalık</option>
          <option value="monthly">Aylık</option>
        </select>
      </div>
      <div className="leaderTable">
        {loading ? (
          <p>Yükleniyor…</p>
        ) : rows.length ? (
          rows.map((row) => (
            <div key={row.rank}>
              <b>#{row.rank}</b>
              <strong>{row.displayName}</strong>
              <span>{row.score} puan</span>
              <small>{new Date(row.achievedAt).toLocaleDateString("tr-TR")}</small>
            </div>
          ))
        ) : (
          <p>Bu dönemde henüz sıralama yok. İlk sen ol!</p>
        )}
      </div>
    </main>
  );
}

function Profile({ account, onBack }: { account: Account; onBack: () => void }) {
  const [history, setHistory] = useState<any[]>([]);
  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((data) => setHistory(data.history ?? []));
  }, []);
  return (
    <main className="contentPage">
      <button className="back" onClick={onBack}>
        ← Ana sayfa
      </button>
      <div className="eyebrow">OYUNCU PROFİLİ</div>
      <h1>{account?.name}</h1>
      <p>{account?.email}</p>
      <h2>Son oyunlar</h2>
      <div className="leaderTable">
        {history.length ? (
          history.map((entry) => (
            <div key={entry.id}>
              <b>{entry.game.mode === "SOLO" ? "Solo" : entry.won ? "Kazandı" : "Kaybetti"}</b>
              <strong>{entry.game.difficulty}</strong>
              <span>{entry.score} puan</span>
              <small>{new Date(entry.game.endedAt).toLocaleDateString("tr-TR")}</small>
            </div>
          ))
        ) : (
          <p>Henüz tamamlanmış bir oyunun yok.</p>
        )}
      </div>
    </main>
  );
}
