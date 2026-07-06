import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, Modal, FlatList, Alert,
  StatusBar, ImageBackground, Image, NativeModules,
  PermissionsAndroid, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Slider from "@react-native-community/slider";
import { Audio } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";

const { ChapterExtractor, PlaybackService } = NativeModules;

function startPlaybackService(title) {
  try { PlaybackService?.start(title || "Аудио плейър"); } catch {}
}

function stopPlaybackService() {
  try { PlaybackService?.stop(); } catch {}
}

async function extractChapters(uri) {
  try {
    const path = uri.startsWith("file://") ? uri.replace("file://", "") : uri;
    const chapters = await ChapterExtractor.extractChapters(path);
    return chapters || [];
  } catch (e) {
    return [];
  }
}

async function extractCover(uri) {
  try {
    const path = uri.startsWith("file://") ? uri.replace("file://", "") : uri;
    const cover = await ChapterExtractor.extractCover(path);
    return cover || null;
  } catch (e) {
    return null;
  }
}

// ── Преводи ───────────────────────────────────────────────
const T = {
  bg: {
    appTitle: "Аудио Плейър", tabPlayer: "▶ Плейър", tabContents: "📑 Съдържание",
    tabNotes: "📝 Бележки", tabDiary: "📔 Дневник", pickFile: "📁  Избери аудио файл",
    speed: "Скорост", sleepTimer: "Sleep timer",
    prevChapter: "⏮ Предишна", nextChapter: "Следваща ⏭", extracting: "⏳ Извличане на глави...",
    noChapters: "Файлът няма вградени глави", noAudio: "Зареди книга",
    library: "Последно слушани", noBooks: "Няма запазени книги",
    continueFrom: "Продължи от там", continueMsg: "Последно слушано на",
    fromStart: "От начало", continueBtn: "Продължи", chapters: "глави",
    allDiary: "Целият дневник", diaryEmpty: "Дневникът е празен",
    notesEmpty: "Няма бележки за тази книга", notesPlaceholder: "Бележка @",
    diaryPlaceholder: "Нов запис в дневника...", loadBookNotes: "Зареди книга за бележки",
    loadBookDiary: "Зареди книга за дневник", close: "Затвори", cancel: "Отказ",
    error: "Грешка", noTitle: "Без заглавие", goToTime: "Отиди на",
  },
  en: {
    appTitle: "Audio Player", tabPlayer: "▶ Player", tabContents: "📑 Contents",
    tabNotes: "📝 Notes", tabDiary: "📔 Diary", pickFile: "📁  Choose audio file",
    speed: "Speed", sleepTimer: "Sleep timer",
    prevChapter: "⏮ Previous", nextChapter: "Next ⏭", extracting: "⏳ Extracting chapters...",
    noChapters: "File has no chapters", noAudio: "Load a book",
    library: "Recently played", noBooks: "No saved books",
    continueFrom: "Continue from", continueMsg: "Last played at",
    fromStart: "From start", continueBtn: "Continue", chapters: "chapters",
    allDiary: "Full diary", diaryEmpty: "Diary is empty",
    notesEmpty: "No notes for this book", notesPlaceholder: "Note @",
    diaryPlaceholder: "New diary entry...", loadBookNotes: "Load a book to add notes",
    loadBookDiary: "Load a book to keep a diary", close: "Close", cancel: "Cancel",
    error: "Error", noTitle: "No title", goToTime: "Go to",
  },
  ru: {
    appTitle: "Аудио Плеер", tabPlayer: "▶ Плеер", tabContents: "📑 Содержание",
    tabNotes: "📝 Заметки", tabDiary: "📔 Дневник", pickFile: "📁  Выбрать аудио файл",
    speed: "Скорость", sleepTimer: "Таймер сна",
    prevChapter: "⏮ Предыдущая", nextChapter: "Следующая ⏭", extracting: "⏳ Извлечение глав...",
    noChapters: "В файле нет глав", noAudio: "Загрузите книгу",
    library: "Недавно слушали", noBooks: "Нет сохранённых книг",
    continueFrom: "Продолжить с", continueMsg: "Последний раз на",
    fromStart: "Сначала", continueBtn: "Продолжить", chapters: "глав",
    allDiary: "Весь дневник", diaryEmpty: "Дневник пуст",
    notesEmpty: "Нет заметок", notesPlaceholder: "Заметка @",
    diaryPlaceholder: "Новая запись...", loadBookNotes: "Загрузите книгу для заметок",
    loadBookDiary: "Загрузите книгу для дневника", close: "Закрыть", cancel: "Отмена",
    error: "Ошибка", noTitle: "Без названия", goToTime: "Перейти к",
  },
};

function getLocale() {
  const locale = Localization.getLocales?.()?.[0]?.languageCode || "bg";
  return T[locale] ? locale : "bg";
}

const C = {
  bg: "#0d0d0d", surface: "#1a1a1a", card: "#222222",
  border: "#2a2a2a", accent: "#e8a020", accentDim: "#3a2808",
  text: "#f0f0f0", textDim: "#888888", textMuted: "#444444",
};

const fmt = (ms) => {
  if (!ms || isNaN(ms)) return "0:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m%60).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
};

const SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
const SLEEP_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90];
const STORAGE = {
  positions: "pos_v10", chapters: "chap_v10",
  notes: "notes_v10", diary: "diary_v10", covers: "covers_v10",
};

function bookId(uri, title) {
  return `${title}_${uri.split("/").pop()}`.replace(/[^a-zA-Z0-9_а-яА-Я]/g, "_");
}

export default function App() {
  const locale = getLocale();
  const i = T[locale];

  const soundRef = useRef(null);
  const positionRef = useRef(0);
  const durationRef = useRef(0);
  const sleepEndTimeRef = useRef(null);
  const sleepCheckRef = useRef(null);
  const positionSaveRef = useRef(null);
  const chaptersListRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1.0);
  const [title, setTitle] = useState(i.noTitle);
  const [fileUri, setFileUri] = useState(null);
  const [bookKey, setBookKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [coverUri, setCoverUri] = useState(null);

  const [sleepEndTime, setSleepEndTime] = useState(null);
  const [sleepRemaining, setSleepRemaining] = useState(null);
  const [showSleep, setShowSleep] = useState(false);

  const [savedPositions, setSavedPositions] = useState({});
  const [showLibrary, setShowLibrary] = useState(false);
  const [allCovers, setAllCovers] = useState({});

  const [allNotes, setAllNotes] = useState({});
  const [allDiary, setAllDiary] = useState({});
  const [noteText, setNoteText] = useState("");
  const [diaryText, setDiaryText] = useState("");
  const [activeTab, setActiveTab] = useState("player");
  const [showAllDiary, setShowAllDiary] = useState(false);

  const [trialDaysLeft, setTrialDaysLeft] = useState(14);
  const [showPaywall, setShowPaywall] = useState(false);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
    });
    if (Platform.OS === "android" && Platform.Version >= 33) {
      PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
    }
    AsyncStorage.getItem(STORAGE.positions).then(v => v && setSavedPositions(JSON.parse(v)));
    AsyncStorage.getItem(STORAGE.notes).then(v => v && setAllNotes(JSON.parse(v)));
    AsyncStorage.getItem(STORAGE.diary).then(v => v && setAllDiary(JSON.parse(v)));
    AsyncStorage.getItem(STORAGE.covers).then(v => v && setAllCovers(JSON.parse(v)));

    AsyncStorage.getItem("install_date").then(async (val) => {
      if (!val) await AsyncStorage.setItem("install_date", Date.now().toString());
      else {
        const days = (Date.now() - parseInt(val)) / (1000 * 60 * 60 * 24);
        const left = Math.max(0, Math.ceil(14 - days));
        setTrialDaysLeft(left);
        if (left === 0) setShowPaywall(true);
      }
    });

    return () => {
      soundRef.current?.unloadAsync();
      clearInterval(sleepCheckRef.current);
      clearInterval(positionSaveRef.current);
      stopPlaybackService();
    };
  }, []);

  // Foreground service — пази процеса жив докато свири (иначе Android го убива при изгасен екран)
  useEffect(() => {
    if (isPlaying) startPlaybackService(title);
    else stopPlaybackService();
  }, [isPlaying, title]);

  // Sleep timer
  useEffect(() => {
    clearInterval(sleepCheckRef.current);
    if (!sleepEndTime) { setSleepRemaining(null); return; }
    sleepEndTimeRef.current = sleepEndTime;
    sleepCheckRef.current = setInterval(async () => {
      const remaining = Math.max(0, Math.floor((sleepEndTimeRef.current - Date.now()) / 1000));
      setSleepRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(sleepCheckRef.current);
        setSleepEndTime(null);
        await soundRef.current?.pauseAsync();
      }
    }, 1000);
    return () => clearInterval(sleepCheckRef.current);
  }, [sleepEndTime]);

  // Запазване на позицията
  useEffect(() => {
    clearInterval(positionSaveRef.current);
    if (!fileUri) return;
    positionSaveRef.current = setInterval(async () => {
      const pos = positionRef.current;
      if (!pos) return;
      const updated = { ...savedPositions, [fileUri]: { position: pos, title, timestamp: Date.now() } };
      setSavedPositions(updated);
      await AsyncStorage.setItem(STORAGE.positions, JSON.stringify(updated));
    }, 5000);
    return () => clearInterval(positionSaveRef.current);
  }, [fileUri, title]);

  // Автоскрол в съдържание
  useEffect(() => {
    if (activeTab !== "contents" || !chaptersListRef.current || chapters.length === 0) return;
    const idx = getCurrentChapterIdx();
    if (idx >= 0) {
      try { chaptersListRef.current.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 }); } catch {}
    }
  }, [position, activeTab]);

  const getCurrentChapterIdx = () => chapters.findIndex((ch, idx) => {
    const next = chapters[idx + 1];
    const posS = position / 1000;
    return posS >= ch.start / 1000 && (!next || posS < next.start / 1000);
  });

  const loadSound = useCallback(async (uri, displayTitle) => {
    setLoading(true);
    setExtracting(true);
    setChapters([]);
    setCoverUri(null);
    try {
      if (soundRef.current) {
        clearInterval(positionSaveRef.current);
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }

      const bKey = bookId(uri, displayTitle);
      setBookKey(bKey);

      // Кеширани глави
      const cachedRaw = await AsyncStorage.getItem(STORAGE.chapters);
      const cached = cachedRaw ? JSON.parse(cachedRaw) : {};

      if (cached[bKey] && cached[bKey].length > 0) {
        setChapters(cached[bKey]);
        setExtracting(false);
      } else {
        // Извличи глави с native модул
        const extracted = await extractChapters(uri);
        setChapters(extracted);
        setExtracting(false);
        if (extracted.length > 0) {
          await AsyncStorage.setItem(STORAGE.chapters, JSON.stringify({ ...cached, [bKey]: extracted }));
        }
      }

      // Кеширана корица
      const coversRaw = await AsyncStorage.getItem(STORAGE.covers);
      const covers = coversRaw ? JSON.parse(coversRaw) : {};
      if (covers[bKey]) setCoverUri(covers[bKey]);

      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false, rate: speed, progressUpdateIntervalMillis: 500 },
        (s) => {
          if (s.isLoaded) {
            setPosition(s.positionMillis || 0);
            positionRef.current = s.positionMillis || 0;
            setDuration(s.durationMillis || 0);
            durationRef.current = s.durationMillis || 0;
            setIsPlaying(s.isPlaying);
          }
        }
      );

      soundRef.current = sound;
      setTitle(displayTitle);
      setFileUri(uri);

      const saved = savedPositions[uri];
      if (saved?.position > 30000) {
        Alert.alert(
          i.continueFrom,
          `${i.continueMsg} ${fmt(saved.position)}`,
          [
            { text: i.fromStart, style: "cancel" },
            { text: i.continueBtn, onPress: () => sound.setPositionAsync(saved.position) },
          ]
        );
      }
    } catch (e) {
      Alert.alert(i.error, e.message);
      setExtracting(false);
    }
    setLoading(false);
  }, [speed, savedPositions]);

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["audio/*", "application/octet-stream"],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const name = asset.name?.replace(/\.[^.]+$/, "") || i.noTitle;
        await loadSound(asset.uri, name);
      }
    } catch (e) {
      Alert.alert(i.error, e.message);
    }
  };

  const pickCover = async () => {
    if (!bookKey) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (!result.canceled && result.assets?.[0]) {
        const uri = result.assets[0].uri;
        setCoverUri(uri);
        const updated = { ...allCovers, [bookKey]: uri };
        setAllCovers(updated);
        await AsyncStorage.setItem(STORAGE.covers, JSON.stringify(updated));
      }
    } catch (e) {
      Alert.alert(i.error, e.message);
    }
  };

  const togglePlay = async () => {
    if (!soundRef.current) return;
    if (isPlaying) await soundRef.current.pauseAsync();
    else await soundRef.current.playAsync();
  };

  const seek = async (ms) => {
    if (!soundRef.current) return;
    await soundRef.current.setPositionAsync(ms);
    setPosition(ms);
    positionRef.current = ms;
  };

  const skip = async (sec) => {
    const newPos = Math.max(0, Math.min(durationRef.current, positionRef.current + sec * 1000));
    await seek(newPos);
  };

  const changeSpeed = async (s) => {
    setSpeed(s);
    if (soundRef.current) await soundRef.current.setRateAsync(s, true);
  };

  const startSleep = (minutes) => {
    setSleepEndTime(Date.now() + minutes * 60 * 1000);
    setShowSleep(false);
  };

  const currentChapterIdx = getCurrentChapterIdx();
  const currentChapter = currentChapterIdx >= 0 ? chapters[currentChapterIdx] : null;

  const chapterProgress = (() => {
    if (!currentChapter) return 0;
    const chStart = currentChapter.start;
    const chEnd = currentChapter.end || (chapters[currentChapterIdx + 1]?.start) || duration;
    const chDuration = chEnd - chStart;
    if (chDuration <= 0) return 0;
    return Math.max(0, Math.min(1, (position - chStart) / chDuration));
  })();

  const chapterRemaining = (() => {
    if (!currentChapter) return 0;
    const chEnd = currentChapter.end || (chapters[currentChapterIdx + 1]?.start) || duration;
    return Math.max(0, chEnd - position);
  })();

  const bookNotes = bookKey ? (allNotes[bookKey] || []) : [];
  const bookDiary = bookKey ? (allDiary[bookKey] || []) : [];
  const allDiaryEntries = Object.values(allDiary).flat().sort((a, b) => b.id - a.id);

  const saveNote = async () => {
    if (!noteText.trim() || !bookKey) return;
    const newNote = { id: Date.now(), text: noteText.trim(), position: positionRef.current, time: fmt(positionRef.current), date: new Date().toLocaleDateString(locale) };
    const updated = { ...allNotes, [bookKey]: [...bookNotes, newNote] };
    setAllNotes(updated);
    setNoteText("");
    await AsyncStorage.setItem(STORAGE.notes, JSON.stringify(updated));
  };

  const deleteNote = async (id) => {
    const updated = { ...allNotes, [bookKey]: bookNotes.filter(n => n.id !== id) };
    setAllNotes(updated);
    await AsyncStorage.setItem(STORAGE.notes, JSON.stringify(updated));
  };

  const saveDiary = async () => {
    if (!diaryText.trim() || !bookKey) return;
    const entry = { id: Date.now(), text: diaryText.trim(), book: title, date: new Date().toLocaleDateString(locale), time: new Date().toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) };
    const updated = { ...allDiary, [bookKey]: [entry, ...bookDiary] };
    setAllDiary(updated);
    setDiaryText("");
    await AsyncStorage.setItem(STORAGE.diary, JSON.stringify(updated));
  };

  const deleteDiary = async (id) => {
    const updated = { ...allDiary, [bookKey]: bookDiary.filter(e => e.id !== id) };
    setAllDiary(updated);
    await AsyncStorage.setItem(STORAGE.diary, JSON.stringify(updated));
  };

  const hasAudio = !!fileUri;
  const TABS = ["player", "contents", "notes", "diary"];
  const TAB_LABELS = { player: i.tabPlayer, contents: i.tabContents, notes: i.tabNotes, diary: i.tabDiary };

  const PlayerBackground = ({ children }) => {
    if (coverUri) {
      return (
        <ImageBackground source={{ uri: coverUri }} style={s.playerBg} blurRadius={25}>
          <View style={s.playerBgOverlay}>{children}</View>
        </ImageBackground>
      );
    }
    return <View style={s.playerBg}>{children}</View>;
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={s.header}>
        <Text style={s.headerTitle}>🎧 {i.appTitle}</Text>
        <View style={s.headerBtns}>
          <TouchableOpacity onPress={pickFile} style={s.headerAddBtn}>
            <Text style={s.headerAddBtnText}>＋</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowAllDiary(true)}>
            <Text style={s.headerBtn}>📔</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowLibrary(true)}>
            <Text style={s.headerBtn}>📚</Text>
          </TouchableOpacity>
        </View>
      </View>

      {trialDaysLeft > 0 && trialDaysLeft <= 7 && (
        <TouchableOpacity style={s.trialBanner} onPress={() => setShowPaywall(true)}>
          <Text style={s.trialText}>
            {locale === "bg" ? `⏳ Безплатен период: ${trialDaysLeft} дни` :
             locale === "ru" ? `⏳ Пробный период: ${trialDaysLeft} дней` :
             `⏳ Trial: ${trialDaysLeft} days left`}
          </Text>
        </TouchableOpacity>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabsScroll}>
        <View style={s.tabs}>
          {TABS.map((tab) => (
            <TouchableOpacity key={tab} style={[s.tab, activeTab === tab && s.tabActive]} onPress={() => setActiveTab(tab)}>
              <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>{TAB_LABELS[tab]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {activeTab === "player" && (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <PlayerBackground>
            <ScrollView contentContainerStyle={s.scroll}>
              <View style={s.coverBox}>
                <TouchableOpacity onPress={pickCover} style={s.coverWrapper}>
                  {coverUri
                    ? <Image source={{ uri: coverUri }} style={s.coverImage} />
                    : (
                      <View style={s.coverPlaceholder}>
                        {hasAudio
                          ? <Text style={s.coverAddHint}>🖼</Text>
                          : <TouchableOpacity onPress={pickFile} style={s.coverAddBtn}>
                              <Text style={s.coverAddBtnText}>＋</Text>
                              <Text style={s.coverAddBtnLabel}>{i.pickFile}</Text>
                            </TouchableOpacity>
                        }
                      </View>
                    )
                  }
                  {hasAudio && <View style={s.coverEditBadge}><Text style={s.coverEditText}>🖼</Text></View>}
                </TouchableOpacity>
                <Text style={s.bookTitle} numberOfLines={2}>{title}</Text>
                {extracting && <Text style={s.extracting}>{i.extracting}</Text>}
                {!extracting && currentChapter && <Text style={s.chapterLabel}>📑 {currentChapter.title}</Text>}
              </View>

              <View style={s.progressBox}>
                <Slider
                  style={s.slider}
                  minimumValue={0}
                  maximumValue={duration || 1}
                  value={position}
                  minimumTrackTintColor={C.accent}
                  maximumTrackTintColor="rgba(255,255,255,0.2)"
                  thumbTintColor={C.accent}
                  onSlidingComplete={seek}
                  disabled={!hasAudio}
                />
                <View style={s.timeRow}>
                  <Text style={s.timeText}>{fmt(position)}</Text>
                  <Text style={s.timeText}>{fmt(duration)}</Text>
                </View>
              </View>

              {currentChapter && (
                <View style={s.chapterProgressBox}>
                  <View style={s.chapterProgressRow}>
                    <Text style={s.chapterProgressLabel} numberOfLines={1}>📑 {currentChapter.title}</Text>
                    <Text style={s.chapterProgressTime}>–{fmt(chapterRemaining)}</Text>
                  </View>
                  <View style={s.chapterProgressBar}>
                    <View style={[s.chapterProgressFill, { width: `${chapterProgress * 100}%` }]} />
                  </View>
                  <Text style={s.chapterProgressPct}>{Math.round(chapterProgress * 100)}%</Text>
                </View>
              )}

              <View style={s.controls}>
                <TouchableOpacity style={s.skipBtn} onPress={() => skip(-30)} disabled={!hasAudio}>
                  <Text style={[s.skipText, !hasAudio && s.disabled]}>⟪ 30</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.playBtn} onPress={togglePlay} disabled={!hasAudio || loading}>
                  {loading ? <ActivityIndicator color={C.bg} size="large" /> : <Text style={s.playIcon}>{isPlaying ? "⏸" : "▶"}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={s.skipBtn} onPress={() => skip(30)} disabled={!hasAudio}>
                  <Text style={[s.skipText, !hasAudio && s.disabled]}>30 ⟫</Text>
                </TouchableOpacity>
              </View>

              {chapters.length > 0 && (
                <View style={s.row}>
                  <TouchableOpacity style={s.actionBtn} disabled={currentChapterIdx <= 0} onPress={() => seek(chapters[currentChapterIdx - 1].start)}>
                    <Text style={[s.actionBtnText, currentChapterIdx <= 0 && s.disabled]}>{i.prevChapter}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.actionBtn} disabled={currentChapterIdx >= chapters.length - 1} onPress={() => seek(chapters[currentChapterIdx + 1].start)}>
                    <Text style={[s.actionBtnText, currentChapterIdx >= chapters.length - 1 && s.disabled]}>{i.nextChapter}</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={s.speedRow}>
                <Text style={s.sectionLabel}>{i.speed}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={s.speedBtns}>
                    {SPEEDS.map((sp) => (
                      <TouchableOpacity key={sp} style={[s.speedBtn, speed === sp && s.speedBtnActive]} onPress={() => changeSpeed(sp)}>
                        <Text style={[s.speedBtnText, speed === sp && s.speedBtnTextActive]}>{sp}x</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              <View style={s.row}>
                <TouchableOpacity style={[s.actionBtn, sleepEndTime && s.actionBtnActive]} onPress={() => sleepEndTime ? setSleepEndTime(null) : setShowSleep(true)}>
                  <Text style={s.actionBtnText}>
                    🌙 {sleepRemaining !== null ? `${Math.floor(sleepRemaining/60)}:${String(sleepRemaining%60).padStart(2,"0")}` : i.sleepTimer}
                  </Text>
                </TouchableOpacity>
              </View>

              {hasAudio && (
                <View style={s.loadSection}>
                  <TouchableOpacity style={s.loadBtn} onPress={pickFile}>
                    <Text style={s.loadBtnText}>{i.pickFile}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </PlayerBackground>
        </ScrollView>
      )}

      {activeTab === "contents" && (
        <View style={s.notesContainer}>
          <Text style={s.notesTitle}>
            {chapters.length > 0 ? `📑 ${chapters.length} ${i.chapters}` : extracting ? i.extracting : i.noChapters}
          </Text>
          {chapters.length > 0 && (
            <FlatList
              ref={chaptersListRef}
              data={chapters}
              keyExtractor={(_, idx) => String(idx)}
              onScrollToIndexFailed={() => {}}
              renderItem={({ item, index }) => {
                const isActive = index === currentChapterIdx;
                return (
                  <TouchableOpacity
                    style={[s.chapterItem, isActive && s.chapterItemActive]}
                    onPress={() => { seek(item.start); setActiveTab("player"); }}
                  >
                    <View style={s.chapterItemLeft}>
                      {isActive && <View style={s.chapterItemDot} />}
                      <Text style={[s.chapterItemText, isActive && s.chapterItemTextActive]} numberOfLines={1}>{item.title}</Text>
                    </View>
                    <Text style={s.chapterItemTime}>{fmt(item.start)}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          )}
          {!extracting && chapters.length === 0 && <Text style={s.emptyText}>{hasAudio ? i.noChapters : i.noAudio}</Text>}
        </View>
      )}

      {activeTab === "notes" && (
        <View style={s.notesContainer}>
          <Text style={s.notesTitle}>{hasAudio ? `📝 ${title}` : `📝 ${i.noAudio}`}</Text>
          {hasAudio ? (
            <>
              <View style={s.noteInputRow}>
                <TextInput style={s.noteInput} value={noteText} onChangeText={setNoteText}
                  placeholder={`${i.notesPlaceholder} ${fmt(positionRef.current)}...`}
                  placeholderTextColor={C.textMuted} multiline />
                <TouchableOpacity style={s.noteSaveBtn} onPress={saveNote}>
                  <Text style={s.noteSaveBtnText}>💾</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={bookNotes}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <View style={s.noteItem}>
                    <View style={s.noteItemHeader}>
                      <View style={s.noteItemHeaderLeft}>
                        <TouchableOpacity style={s.noteTimeBadge} onPress={() => { seek(item.position); setActiveTab("player"); }}>
                          <Text style={s.noteTimeBadgeText}>⏱ {item.time}</Text>
                        </TouchableOpacity>
                        <Text style={s.noteDate}>📅 {item.date}</Text>
                      </View>
                      <TouchableOpacity onPress={() => deleteNote(item.id)}>
                        <Text style={s.noteDelete}>🗑</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={s.noteText}>{item.text}</Text>
                    <TouchableOpacity style={s.noteGoToBtn} onPress={() => { seek(item.position); setActiveTab("player"); }}>
                      <Text style={s.noteGoToBtnText}>▶ {i.goToTime} {item.time}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                ListEmptyComponent={<Text style={s.emptyText}>{i.notesEmpty}</Text>}
              />
            </>
          ) : <Text style={s.emptyText}>{i.loadBookNotes}</Text>}
        </View>
      )}

      {activeTab === "diary" && (
        <View style={s.notesContainer}>
          <Text style={s.notesTitle}>{hasAudio ? `📔 ${title}` : `📔 ${i.noAudio}`}</Text>
          {hasAudio ? (
            <>
              <View style={s.noteInputRow}>
                <TextInput style={s.noteInput} value={diaryText} onChangeText={setDiaryText}
                  placeholder={i.diaryPlaceholder} placeholderTextColor={C.textMuted} multiline />
                <TouchableOpacity style={s.noteSaveBtn} onPress={saveDiary}>
                  <Text style={s.noteSaveBtnText}>💾</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={bookDiary}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                  <View style={s.noteItem}>
                    <View style={s.noteItemHeader}>
                      <Text style={s.noteTime}>📅 {item.date} {item.time}</Text>
                      <TouchableOpacity onPress={() => deleteDiary(item.id)}>
                        <Text style={s.noteDelete}>🗑</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={s.noteText}>{item.text}</Text>
                  </View>
                )}
                ListEmptyComponent={<Text style={s.emptyText}>{i.notesEmpty}</Text>}
              />
            </>
          ) : <Text style={s.emptyText}>{i.loadBookDiary}</Text>}
        </View>
      )}

      <Modal visible={showSleep} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalBox}>
            <Text style={s.modalTitle}>🌙 {i.sleepTimer}</Text>
            <View style={s.sleepGrid}>
              {SLEEP_OPTIONS.map((m) => (
                <TouchableOpacity key={m} style={s.sleepBtn} onPress={() => startSleep(m)}>
                  <Text style={s.sleepBtnText}>{m} min</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[s.modalCancelBtn, { marginTop: 10 }]} onPress={() => setShowSleep(false)}>
              <Text style={s.modalCancelText}>{i.cancel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showLibrary} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: "80%" }]}>
            <Text style={s.modalTitle}>📚 {i.library}</Text>
            {Object.keys(savedPositions).length === 0
              ? <Text style={s.emptyText}>{i.noBooks}</Text>
              : <FlatList
                  data={Object.entries(savedPositions).sort((a, b) => b[1].timestamp - a[1].timestamp)}
                  keyExtractor={([uri]) => uri}
                  renderItem={({ item: [uri, data] }) => (
                    <TouchableOpacity style={s.chapterItem} onPress={() => { loadSound(uri, data.title); setShowLibrary(false); }}>
                      <Text style={s.chapterItemText} numberOfLines={1}>{data.title}</Text>
                      <Text style={s.chapterItemTime}>{fmt(data.position)}</Text>
                    </TouchableOpacity>
                  )}
                />
            }
            <TouchableOpacity style={[s.modalCancelBtn, { marginTop: 10 }]} onPress={() => setShowLibrary(false)}>
              <Text style={s.modalCancelText}>{i.close}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showAllDiary} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={[s.modalBox, { maxHeight: "90%" }]}>
            <Text style={s.modalTitle}>📔 {i.allDiary}</Text>
            {allDiaryEntries.length === 0
              ? <Text style={s.emptyText}>{i.diaryEmpty}</Text>
              : <FlatList
                  data={allDiaryEntries}
                  keyExtractor={(item) => String(item.id)}
                  renderItem={({ item }) => (
                    <View style={s.noteItem}>
                      <View style={s.noteItemHeader}>
                        <Text style={s.noteTime}>📖 {item.book}  📅 {item.date} {item.time}</Text>
                      </View>
                      <Text style={s.noteText}>{item.text}</Text>
                    </View>
                  )}
                />
            }
            <TouchableOpacity style={[s.modalCancelBtn, { marginTop: 10 }]} onPress={() => setShowAllDiary(false)}>
              <Text style={s.modalCancelText}>{i.close}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showPaywall} transparent animationType="fade">
        <View style={s.paywallOverlay}>
          <View style={s.paywallBox}>
            <Text style={s.paywallTitle}>🎧 {i.appTitle}</Text>
            <Text style={s.paywallSubtitle}>
              {locale === "bg" ? "Безплатният период е изтекъл" :
               locale === "ru" ? "Пробный период истёк" : "Your trial period has ended"}
            </Text>
            <TouchableOpacity style={s.paywallBtn}>
              <Text style={s.paywallBtnText}>
                {locale === "bg" ? "Купи — еднократно плащане" :
                 locale === "ru" ? "Купить — разовый платёж" : "Buy — one-time payment"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.paywallSkipBtn} onPress={() => setShowPaywall(false)}>
              <Text style={s.paywallSkipText}>
                {locale === "bg" ? "Продължи с ограничения" :
                 locale === "ru" ? "Продолжить с ограничениями" : "Continue with limitations"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:                  { flex: 1, backgroundColor: C.bg },
  playerBg:              { flex: 1 },
  playerBgOverlay:       { flex: 1, backgroundColor: "rgba(0,0,0,0.75)" },
  scroll:                { padding: 20, paddingBottom: 40 },
  header:                { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle:           { color: C.text, fontSize: 17, fontWeight: "700" },
  headerBtns:            { flexDirection: "row", gap: 12, alignItems: "center" },
  headerBtn:             { fontSize: 22 },
  headerAddBtn:          { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accent, justifyContent: "center", alignItems: "center" },
  headerAddBtnText:      { color: C.bg, fontSize: 22, fontWeight: "700", lineHeight: 26 },
  trialBanner:           { backgroundColor: C.accentDim, paddingVertical: 6, paddingHorizontal: 20 },
  trialText:             { color: C.accent, fontSize: 12, textAlign: "center", fontWeight: "600" },
  tabsScroll:            { maxHeight: 46, borderBottomWidth: 1, borderBottomColor: C.border },
  tabs:                  { flexDirection: "row" },
  tab:                   { paddingHorizontal: 14, paddingVertical: 12 },
  tabActive:             { borderBottomWidth: 2, borderBottomColor: C.accent },
  tabText:               { color: C.textDim, fontSize: 13, fontWeight: "600" },
  tabTextActive:         { color: C.accent },
  coverBox:              { alignItems: "center", marginBottom: 16, marginTop: 8 },
  coverWrapper:          { position: "relative", marginBottom: 12 },
  coverImage:            { width: 150, height: 150, borderRadius: 16, borderWidth: 2, borderColor: C.accent },
  coverPlaceholder:      { width: 150, height: 150, borderRadius: 16, backgroundColor: "rgba(34,34,34,0.8)", justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: C.border },
  coverAddHint:          { fontSize: 40, opacity: 0.5 },
  coverAddBtn:           { alignItems: "center", gap: 8 },
  coverAddBtnText:       { color: C.accent, fontSize: 40, fontWeight: "300" },
  coverAddBtnLabel:      { color: C.textDim, fontSize: 10, textAlign: "center", paddingHorizontal: 10 },
  coverEditBadge:        { position: "absolute", bottom: 6, right: 6, backgroundColor: "rgba(0,0,0,0.7)", borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2 },
  coverEditText:         { fontSize: 14 },
  bookTitle:             { color: C.text, fontSize: 16, fontWeight: "700", textAlign: "center", marginBottom: 4 },
  chapterLabel:          { color: C.accent, fontSize: 12 },
  extracting:            { color: C.textDim, fontSize: 12, fontStyle: "italic" },
  progressBox:           { marginBottom: 8 },
  slider:                { width: "100%", height: 40 },
  timeRow:               { flexDirection: "row", justifyContent: "space-between" },
  timeText:              { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  chapterProgressBox:    { marginBottom: 14, backgroundColor: "rgba(34,34,34,0.85)", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  chapterProgressRow:    { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  chapterProgressLabel:  { color: C.text, fontSize: 12, fontWeight: "600", flex: 1 },
  chapterProgressTime:   { color: C.textDim, fontSize: 12 },
  chapterProgressBar:    { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: "hidden", marginBottom: 4 },
  chapterProgressFill:   { height: 6, backgroundColor: C.accent, borderRadius: 3 },
  chapterProgressPct:    { color: C.accent, fontSize: 11, textAlign: "right", fontWeight: "600" },
  controls:              { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 24, marginBottom: 16 },
  skipBtn:               { padding: 12 },
  skipText:              { color: C.text, fontSize: 16, fontWeight: "600" },
  playBtn:               { width: 72, height: 72, borderRadius: 36, backgroundColor: C.accent, justifyContent: "center", alignItems: "center" },
  playIcon:              { fontSize: 28, color: C.bg },
  disabled:              { opacity: 0.3 },
  speedRow:              { marginBottom: 16 },
  sectionLabel:          { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  speedBtns:             { flexDirection: "row", gap: 8 },
  speedBtn:              { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: "rgba(34,34,34,0.8)", borderWidth: 1, borderColor: C.border },
  speedBtnActive:        { backgroundColor: C.accent, borderColor: C.accent },
  speedBtnText:          { color: C.textDim, fontSize: 13, fontWeight: "600" },
  speedBtnTextActive:    { color: C.bg },
  row:                   { flexDirection: "row", gap: 10, marginBottom: 14 },
  actionBtn:             { flex: 1, paddingVertical: 11, borderRadius: 12, backgroundColor: "rgba(34,34,34,0.8)", borderWidth: 1, borderColor: C.border, alignItems: "center" },
  actionBtnActive:       { borderColor: C.accent },
  actionBtnText:         { color: C.text, fontSize: 12, fontWeight: "600", textAlign: "center" },
  loadSection:           { marginTop: 8, gap: 10 },
  loadBtn:               { paddingVertical: 14, borderRadius: 12, backgroundColor: "rgba(34,34,34,0.8)", borderWidth: 1, borderColor: C.border, alignItems: "center" },
  loadBtnText:           { color: C.accent, fontSize: 14, fontWeight: "600" },
  notesContainer:        { flex: 1, padding: 16 },
  notesTitle:            { color: C.text, fontSize: 15, fontWeight: "700", marginBottom: 12 },
  noteInputRow:          { flexDirection: "row", gap: 8, marginBottom: 14 },
  noteInput:             { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, color: C.text, fontSize: 14, minHeight: 60, textAlignVertical: "top" },
  noteSaveBtn:           { width: 48, height: 60, backgroundColor: C.accent, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  noteSaveBtnText:       { fontSize: 22 },
  noteItem:              { backgroundColor: C.card, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  noteItemHeader:        { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  noteItemHeaderLeft:    { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  noteTimeBadge:         { backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.accent },
  noteTimeBadgeText:     { color: C.accent, fontSize: 11, fontWeight: "700" },
  noteDate:              { color: C.textDim, fontSize: 11 },
  noteDelete:            { fontSize: 16 },
  noteText:              { color: C.text, fontSize: 14, lineHeight: 20, marginBottom: 8 },
  noteGoToBtn:           { alignSelf: "flex-start", backgroundColor: C.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  noteGoToBtnText:       { color: C.accent, fontSize: 11, fontWeight: "600" },
  noteTime:              { color: C.accent, fontSize: 11, flex: 1 },
  modalOverlay:          { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "flex-end" },
  modalBox:              { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle:            { color: C.text, fontSize: 18, fontWeight: "700", marginBottom: 16 },
  modalCancelBtn:        { paddingVertical: 13, borderRadius: 12, backgroundColor: C.card, alignItems: "center" },
  modalCancelText:       { color: C.textDim, fontSize: 15, fontWeight: "600" },
  sleepGrid:             { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  sleepBtn:              { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  sleepBtnText:          { color: C.text, fontSize: 14, fontWeight: "600" },
  chapterItem:           { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  chapterItemActive:     { backgroundColor: C.accentDim },
  chapterItemLeft:       { flexDirection: "row", alignItems: "center", flex: 1 },
  chapterItemDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, marginRight: 8 },
  chapterItemText:       { color: C.text, fontSize: 14, flex: 1 },
  chapterItemTextActive: { color: C.accent, fontWeight: "700" },
  chapterItemTime:       { color: C.textDim, fontSize: 13, marginLeft: 10 },
  emptyText:             { color: C.textDim, textAlign: "center", padding: 20 },
  paywallOverlay:        { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center", alignItems: "center", padding: 30 },
  paywallBox:            { backgroundColor: C.surface, borderRadius: 24, padding: 30, width: "100%", alignItems: "center" },
  paywallTitle:          { color: C.text, fontSize: 24, fontWeight: "700", marginBottom: 8 },
  paywallSubtitle:       { color: C.textDim, fontSize: 15, textAlign: "center", marginBottom: 24 },
  paywallBtn:            { backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 30, width: "100%", alignItems: "center", marginBottom: 12 },
  paywallBtnText:        { color: C.bg, fontSize: 16, fontWeight: "700" },
  paywallSkipBtn:        { paddingVertical: 10 },
  paywallSkipText:       { color: C.textDim, fontSize: 13 },
});
