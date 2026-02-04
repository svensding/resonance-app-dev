
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { DrawnCardDisplayData as SingleDrawnCardData } from './components/DrawnCard'; 
import { 
  generateCardFront,
  generateCardBack,
  generateAudioForText,
  sendFeedbackToChat,
  CustomThemeData, 
  CustomThemeId, 
  ThemeIdentifier, 
  ThemedDeck,
  VoiceName, 
  LanguageCode, 
  DEFAULT_VOICE_NAME, 
  DEFAULT_LANGUAGE_CODE, 
  CURATED_VOICE_PERSONAS,
  GROUP_SETTINGS,
  SocialContext, 
  DEFAULT_GROUP_SETTING, 
  ALL_THEMED_DECKS,
  DECK_CATEGORIES,
  getThemedDeckById, 
  getCustomDeckById, 
  getDisplayDataForCard,
  getStyleDirectiveForCard,
  getChatSessionHistory,
  DrawnCardData,
  AgeFilters,
  getVisibleDecks,
  CoreTheme,
  CardType,
  IntensityLevel,
  ALL_INTENSITY_LEVELS,
  CUSTOM_DECK_COLOR_PALETTE,
  performHealthCheck,
  resetChatSession,
  drawOfflineCard,
  OFFLINE_DECK,
} from './services/geminiService';
import { playAudioData, speakText, stopSpeechServicePlayback, resumeAudioContext } from './services/speechService'; 
import { ApiKeyMessage } from './components/ApiKeyMessage';
import { ThemeDeckSelection } from './components/ThemeDeckSelection';
import { DrawnCardsHistoryView } from './components/DrawnCardsHistoryView';
import { BottomToolbar, Participant } from './components/BottomToolbar';
import { CustomDeckModal } from './components/CustomDeckModal';
import { VoiceSettingsModal } from './components/VoiceSettingsModal';
import { DeckInfoModal } from './components/DeckInfoModal'; 
import { GroupSettingModal } from './components/GroupSettingModal';
import { DevLogSheet, DevLogEntry } from './components/DevLogSheet';
import { CardShuffleAnimation } from './components/CardShuffleAnimation';


const MAX_HISTORY_WITH_AUDIO = 13; 

const LOCALSTORAGE_KEYS = {
  CUSTOM_DECKS: 'resonanceClio_customDecks_v4', 
  VOICE_NAME: 'resonanceClio_selectedVoiceName_v1',
  LANGUAGE_CODE: 'resonanceClio_selectedLanguageCode_v1',
  IS_MUTED: 'resonanceClio_isAudioMuted_v1',
  GROUP_SETTING: 'resonanceClio_groupSetting_v2',
  AGE_FILTERS: 'resonanceClio_ageFilters_v1',
  INTENSITY_FILTERS: 'resonanceClio_intensityFilters_v1',
};

const loadFromLocalStorage = <T,>(key: string, defaultValue: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : defaultValue;
  } catch (e) {
    console.warn(`Error reading localStorage key "${key}":`, e);
    return defaultValue;
  }
};

const saveToLocalStorage = <T,>(key: string, value: T) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Error setting localStorage key "${key}":`, e);
  }
};

const App: React.FC = () => {
  const [drawnCardHistory, setDrawnCardHistory] = useState<DrawnCardData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isShuffling, setIsShuffling] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKeyMissing, setApiKeyMissing] = useState<boolean>(false);
  
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeParticipantId, setActiveParticipantId] = useState<string | null>(null);
  const [selectedGroupSetting, setSelectedGroupSetting] = useState<SocialContext>(() => loadFromLocalStorage<SocialContext>(LOCALSTORAGE_KEYS.GROUP_SETTING, DEFAULT_GROUP_SETTING));
  const [showGroupSettingModal, setShowGroupSettingModal] = useState<boolean>(false);
  
  const [activeCardAudio, setActiveCardAudio] = useState<{ cardId: string; type: 'prompt' | 'notes' } | null>(null);

  const [customDecks, setCustomDecks] = useState<CustomThemeData[]>([]);
  const [showCustomDeckModal, setShowCustomDeckModal] = useState<boolean>(false);
  const [editingCustomDeck, setEditingCustomDeck] = useState<CustomThemeData | null>(null);
  
  const [shuffleColorClasses, setShuffleColorClasses] = useState<string[]>([]);

  const [showDeckInfoModal, setShowDeckInfoModal] = useState<boolean>(false);
  const [itemForInfoModal, setItemForInfoModal] = useState<ThemedDeck | CustomThemeData | null>(null);

  const [selectedVoiceName, setSelectedVoiceName] = useState<VoiceName>(DEFAULT_VOICE_NAME);
  const [selectedLanguageCode, setSelectedLanguageCode] = useState<LanguageCode>(() => loadFromLocalStorage<LanguageCode>(LOCALSTORAGE_KEYS.LANGUAGE_CODE, "en-US"));
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [showVoiceSettingsModal, setShowVoiceSettingsModal] = useState<boolean>(false);
  const [ageFilters, setAgeFilters] = useState<AgeFilters>(() => loadFromLocalStorage<AgeFilters>(LOCALSTORAGE_KEYS.AGE_FILTERS, { adults: true, teens: false, kids: false }));
  const [intensityFilters, setIntensityFilters] = useState<IntensityLevel[]>(() => loadFromLocalStorage<IntensityLevel[]>(LOCALSTORAGE_KEYS.INTENSITY_FILTERS, ALL_INTENSITY_LEVELS));
  
  const [isTtsSystemAvailable, setIsTtsSystemAvailable] = useState<boolean>(true);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(false);

  const [showDevLogSheet, setShowDevLogSheet] = useState(false);
  const [devLog, setDevLog] = useState<DevLogEntry[]>([]);
  const [showDevFeatures, setShowDevFeatures] = useState(false);
  const devModeActivated = useRef(false);
  
  // Wake Lock Ref
  const wakeLockRef = useRef<any>(null);

  const addLogEntry = useCallback((entry: DevLogEntry) => {
      setDevLog(prev => [...prev, entry]);
  }, []);

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err) {
        console.warn("Wake Lock failed", err);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch (err) {
        console.warn("Wake Lock release failed", err);
      }
    }
  };

  useEffect(() => {
    const setAppHeight = () => {
        const doc = document.documentElement;
        doc.style.setProperty('--app-height', `${window.innerHeight}px`);
    };
    window.addEventListener('resize', setAppHeight);
    setAppHeight();
    return () => window.removeEventListener('resize', setAppHeight);
  }, []);
  
  useEffect(() => {
    saveToLocalStorage<AgeFilters>(LOCALSTORAGE_KEYS.AGE_FILTERS, ageFilters);
  }, [ageFilters]);

  useEffect(() => {
    saveToLocalStorage<IntensityLevel[]>(LOCALSTORAGE_KEYS.INTENSITY_FILTERS, intensityFilters);
  }, [intensityFilters]);

  useEffect(() => {
    saveToLocalStorage<LanguageCode>(LOCALSTORAGE_KEYS.LANGUAGE_CODE, selectedLanguageCode);
  }, [selectedLanguageCode]);

  useEffect(() => {
      const checkDevMode = () => {
          if (devModeActivated.current) return;
          const hasSvenDev = participants.some(p => p.name.toLowerCase().trim() === 'svendev');
          const hasDevHash = window.location.hash === '#devlog';
          if (hasSvenDev || hasDevHash) {
              setShowDevFeatures(true);
              devModeActivated.current = true;
          }
      };
      checkDevMode(); 
      window.addEventListener('hashchange', checkDevMode);
      return () => window.removeEventListener('hashchange', checkDevMode);
  }, [participants]);


  useEffect(() => {
    if (!process.env.API_KEY) {
      setApiKeyMissing(true);
      setError("API_KEY for Gemini is not configured.");
    } else {
        performHealthCheck(addLogEntry).then(status => {
            if (!status.available) {
                setIsOfflineMode(true);
                setError(null);
            } else {
                setIsOfflineMode(false);
                setError(null);
            }
            setIsTtsSystemAvailable(status.ttsAvailable);
        });
    }

    const loadedDecks = loadFromLocalStorage<CustomThemeData[]>(LOCALSTORAGE_KEYS.CUSTOM_DECKS, []);
    setCustomDecks(loadedDecks);
    const loadedVoice = loadFromLocalStorage<VoiceName>(LOCALSTORAGE_KEYS.VOICE_NAME, DEFAULT_VOICE_NAME);
    setSelectedVoiceName(loadedVoice);
    const loadedMute = loadFromLocalStorage<boolean>(LOCALSTORAGE_KEYS.IS_MUTED, false);
    setIsAudioMuted(loadedMute);
    
    if (participants.length === 0) {
        const defaultParticipant = { id: `participant-${Date.now()}`, name: '' };
        setParticipants([defaultParticipant]);
        setActiveParticipantId(defaultParticipant.id);
    }

    return () => {
        stopSpeechServicePlayback();
        resetChatSession();
        releaseWakeLock();
    };
  }, [addLogEntry]);

  const handleStopAudio = useCallback(() => {
    stopSpeechServicePlayback();
    setActiveCardAudio(null);
  }, []);

  const handleRetryConnection = useCallback(async () => {
      const status = await performHealthCheck(addLogEntry);
      setIsOfflineMode(!status.available);
      setIsTtsSystemAvailable(status.ttsAvailable);
      return status.available;
  }, [addLogEntry]);

  const handleShowDeckInfo = useCallback((id: ThemeIdentifier) => {
    const deck = id.startsWith("CUSTOM_")
      ? getCustomDeckById(id as CustomThemeId, customDecks)
      : getThemedDeckById(id as ThemedDeck['id']);
    
    if (deck) {
      setItemForInfoModal(deck);
      setShowDeckInfoModal(true);
    }
  }, [customDecks]);

    const handlePlayAudioForMainPrompt = useCallback(async (
      card: DrawnCardData
    ) => {
        handleStopAudio();
        await resumeAudioContext();
        setActiveCardAudio({ cardId: card.id, type: 'prompt' });
        const onPlaybackEnd = () => setActiveCardAudio(null);
        
        if (card.audioData && card.audioMimeType) {
            playAudioData(card.audioData, card.audioMimeType, isAudioMuted, onPlaybackEnd);
            return;
        }
        if (isAudioMuted) {
            setActiveCardAudio(null);
            return;
        }

        if (card.ttsInput && card.ttsVoice && isTtsSystemAvailable && !isOfflineMode) {
            const audioResult = await generateAudioForText(card.ttsInput, card.ttsVoice, null);
            addLogEntry({
                type: 'tts',
                requestTimestamp: audioResult.requestTimestamp,
                responseTimestamp: audioResult.responseTimestamp,
                data: { ...audioResult.logData, error: audioResult.error, context: 'On-demand generation' }
            });
            if (audioResult.audioData && audioResult.audioMimeType) {
                setDrawnCardHistory(prev => prev.map(c => 
                    c.id === card.id ? { ...c, audioData: audioResult.audioData, audioMimeType: audioResult.audioMimeType } : c
                ));
                playAudioData(audioResult.audioData, audioResult.audioMimeType, isAudioMuted, onPlaybackEnd);
            } else {
                setActiveCardAudio(null);
            }
        } else if (card.text) { 
            speakText(card.text, selectedLanguageCode, isAudioMuted, onPlaybackEnd);
        } else {
            setActiveCardAudio(null);
        }
    }, [isAudioMuted, selectedLanguageCode, handleStopAudio, addLogEntry, isTtsSystemAvailable, isOfflineMode]);

  const handleFetchAndPlayCardBackAudio = useCallback(async (cardId: string, textToSpeak: string) => {
    handleStopAudio();
    await resumeAudioContext();
    if (!isTtsSystemAvailable || isOfflineMode) return;
    setActiveCardAudio({ cardId, type: 'notes' });

    try {
        const cardInHistory = drawnCardHistory.find(c => c.id === cardId || c.activeFollowUpCard?.id === cardId);
        const cardToUse = cardInHistory?.id === cardId ? cardInHistory : cardInHistory?.activeFollowUpCard;
        if (!cardToUse) throw new Error("Card missing");
        
        const deck = !cardToUse.themedDeckId.startsWith("CUSTOM_")
            ? getThemedDeckById(cardToUse.themedDeckId as ThemedDeck['id'])
            : getCustomDeckById(cardToUse.themedDeckId as CustomThemeId, customDecks);
        
        const audioResult = await generateAudioForText(textToSpeak, selectedVoiceName, getStyleDirectiveForCard(selectedVoiceName, true, deck));
        addLogEntry({ type: 'tts', requestTimestamp: audioResult.requestTimestamp, responseTimestamp: audioResult.responseTimestamp, data: { ...audioResult.logData, error: audioResult.error } });

        if (audioResult.audioData && audioResult.audioMimeType) {
            playAudioData(audioResult.audioData, audioResult.audioMimeType, isAudioMuted, () => setActiveCardAudio(null));
        } else {
            setActiveCardAudio(null);
        }
    } catch (err) {
        setActiveCardAudio(null);
    }
  }, [selectedVoiceName, isAudioMuted, drawnCardHistory, handleStopAudio, addLogEntry, customDecks, isTtsSystemAvailable, isOfflineMode]);
  
  const handleDrawNewCard = useCallback(async (itemId: ThemeIdentifier | "RANDOM" | `CATEGORY_${string}`, options?: { isRedraw?: boolean }) => {
    if (isLoading || isShuffling) return;

    // Wake Lock & Audio Activation on Draw Start
    await requestWakeLock();
    await resumeAudioContext();

    const performDraw = async () => {
        handleStopAudio();
        setIsLoading(true);
        setIsShuffling(true);
        setError(null);
        let chosenDeck: ThemedDeck | CustomThemeData | undefined;

        try {
            if (isOfflineMode) {
                await new Promise(r => setTimeout(r, 800));
                const offlineCard = drawOfflineCard();
                setDrawnCardHistory(prev => [offlineCard, ...prev.slice(0, MAX_HISTORY_WITH_AUDIO - 1)]);
                setIsShuffling(false);
                setIsLoading(false);
                await releaseWakeLock();
                return;
            }

            const visibleDecks = getVisibleDecks(selectedGroupSetting, ageFilters, intensityFilters, showDevFeatures);
            if (itemId === "RANDOM") {
                chosenDeck = visibleDecks[Math.floor(Math.random() * visibleDecks.length)];
            } else if (itemId.startsWith("CATEGORY_")) {
                const catId = itemId.replace("CATEGORY_", "");
                const inCat = visibleDecks.filter(d => d.category === catId);
                chosenDeck = inCat[Math.floor(Math.random() * inCat.length)];
            } else if (itemId.startsWith("CUSTOM_")) {
                chosenDeck = getCustomDeckById(itemId as CustomThemeId, customDecks) || undefined;
            } else {
                chosenDeck = getThemedDeckById(itemId as ThemedDeck['id']) || undefined;
            }
            if (!chosenDeck) throw new Error("Deck not found");

            const activePName = participants.find(p => p.id === activeParticipantId)?.name || null;
            const frontResult = await generateCardFront(
                chosenDeck, selectedGroupSetting, participants.length, participants.map(p => p.name).filter(Boolean), activePName,
                ageFilters, selectedVoiceName, selectedLanguageCode, drawnCardHistory.length, addLogEntry, !isAudioMuted && isTtsSystemAvailable, { disliked: options?.isRedraw ?? false }
            );

            addLogEntry({ type: 'chat-front', requestTimestamp: frontResult.requestTimestamp, responseTimestamp: frontResult.responseTimestamp, data: { input: frontResult.inputPrompt, output: frontResult.rawLlmOutput, error: frontResult.error } });
            if (frontResult.error) throw new Error(frontResult.error);

            // Fetch Audio (Optional for speed, but user requested reliability)
            let generatedAudioData: string | null = null;
            let generatedAudioMimeType: string | null = null;

            if (!isAudioMuted && isTtsSystemAvailable && frontResult.text) {
                const styleDir = getStyleDirectiveForCard(frontResult.ttsVoice || selectedVoiceName, false, chosenDeck);
                const audioRes = await generateAudioForText(frontResult.ttsInput || frontResult.text, frontResult.ttsVoice || selectedVoiceName, styleDir);
                if (audioRes.audioData) {
                    generatedAudioData = audioRes.audioData;
                    generatedAudioMimeType = audioRes.audioMimeType;
                }
            }

            const newCardId = `card-${Date.now()}`;
            const newCard: DrawnCardData = {
                id: newCardId, themedDeckId: chosenDeck.id, feedback: null, timestamp: Date.now(),
                drawnForParticipantId: activeParticipantId, drawnForParticipantName: participants.find(p => p.id === activeParticipantId)?.name || null,
                text: frontResult.text, ttsInput: frontResult.ttsInput, ttsVoice: frontResult.ttsVoice,
                audioData: generatedAudioData, audioMimeType: generatedAudioMimeType,
                cardBackNotesText: null, isTimed: !!frontResult.reflectionText, hasFollowUp: !!frontResult.reflectionText,
                timerDuration: frontResult.timerDuration, followUpPromptText: frontResult.reflectionText || null,
                followUpAudioData: null, followUpAudioMimeType: null, isCompletedActivity: false, isFollowUp: false, activeFollowUpCard: null,
            };
            
            setDrawnCardHistory(prev => [newCard, ...prev.slice(0, MAX_HISTORY_WITH_AUDIO - 1)]);
            setIsShuffling(false);
            setIsLoading(false);
            if (generatedAudioData && !isAudioMuted) {
                 playAudioData(generatedAudioData, generatedAudioMimeType!, isAudioMuted, () => setActiveCardAudio(null));
                 setActiveCardAudio({ cardId: newCardId, type: 'prompt' });
            }
            
            // Background Card Back Fetch
            generateCardBack(frontResult.text, chosenDeck).then(backResult => {
                if (backResult.cardBackNotesText) {
                    setDrawnCardHistory(prev => prev.map(c => c.id === newCardId ? { ...c, cardBackNotesText: backResult.cardBackNotesText } : c));
                }
            });

        } catch (err: any) {
            setError(err.message || "An unknown error occurred.");
            setIsShuffling(false);
            setIsLoading(false);
        } finally {
            await releaseWakeLock();
        }
    };
    await performDraw();
  }, [isLoading, isShuffling, participants, activeParticipantId, customDecks, selectedVoiceName, selectedLanguageCode, handleStopAudio, isAudioMuted, selectedGroupSetting, ageFilters, intensityFilters, drawnCardHistory.length, addLogEntry, showDevFeatures, isTtsSystemAvailable, isOfflineMode]);

  return (
    <div 
      className="h-full w-full flex bg-slate-900 text-slate-200 overflow-hidden" 
      style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}
    >
      <div className="flex-1 flex flex-col relative min-w-0 mobile-scale-root">
          <header className="flex-shrink-0 z-20 w-full bg-slate-900/80 backdrop-blur-sm shadow-lg h-28 md:h-32">
            <ThemeDeckSelection 
              onDraw={handleDrawNewCard} isDrawingInProgress={isLoading || isShuffling} interactionsDisabled={isLoading || isShuffling}
              customDecks={customDecks} onAddCustomDeck={() => setShowCustomDeckModal(true)}
              onEditCustomDeck={(d) => { setEditingCustomDeck(d); setShowCustomDeckModal(true); }} 
              onShowDeckInfo={(id) => handleShowDeckInfo(id)}
              groupSetting={selectedGroupSetting} ageFilters={ageFilters} intensityFilters={intensityFilters}
              participants={participants} showAllDecks={showDevFeatures} isOfflineMode={isOfflineMode} onRetryConnection={handleRetryConnection}
            />
          </header>
          
          <main className="flex-grow w-full overflow-y-auto overflow-x-hidden scrollbar-thin flex flex-col items-center justify-start p-4 md:p-6">
            {apiKeyMissing ? (
                <div className="flex justify-center items-center h-full"><ApiKeyMessage /></div>
            ) : (
                <>
                    {isOfflineMode && (
                        <div className="w-full max-w-2xl bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 mb-4 flex items-start space-x-3 shadow-sm">
                            <div className="flex-grow">
                                <h4 className="text-sm font-bold text-amber-200">Connection Interrupted</h4>
                                <p className="text-xs text-amber-100/90 mt-1">We've switched to <strong className="text-amber-200">Offline Mode</strong> with backup prompts.</p>
                            </div>
                            <button onClick={() => handleRetryConnection()} className="text-xs bg-amber-800/60 hover:bg-amber-700 text-amber-100 px-3 py-1.5 rounded-md">Reconnect</button>
                        </div>
                    )}
                    {error ? (
                        <div className="flex justify-center items-center p-4">
                            <div className="bg-red-800/80 border border-red-600 text-red-100 px-4 py-3 rounded-lg shadow-md max-w-lg w-full text-center" role="alert">
                                <span className="block sm:inline ml-2">{error}</span>
                                <button onClick={() => setError(null)} className="ml-4 px-2 py-1 bg-red-700 rounded-md">Dismiss</button>
                            </div>
                        </div>
                    ) : (
                      <DrawnCardsHistoryView
                          history={drawnCardHistory} 
                          onLike={(id) => sendFeedbackToChat(id, 'liked', addLogEntry)} 
                          onDislike={(id) => handleStopAudio()} 
                          onPlayAudioForMainPrompt={handlePlayAudioForMainPrompt}
                          onFetchAndPlayCardBackAudio={handleFetchAndPlayCardBackAudio}
                          onTimerEnd={(id) => {}}
                          onRedoTimedActivity={(id) => {}}
                          customDecks={customDecks} activeCardAudio={activeCardAudio} onStopAudio={handleStopAudio} isDrawingInProgress={isLoading || isShuffling}
                      />
                    )}
                </>
            )}
          </main>

          <footer className="flex-shrink-0 z-20 w-full bg-slate-900/80 backdrop-blur-sm">
              <BottomToolbar 
                participants={participants} setParticipants={setParticipants} activeParticipantId={activeParticipantId} setActiveParticipantId={setActiveParticipantId}
                onRemoveParticipant={(id) => {}} groupSetting={selectedGroupSetting} onOpenGroupSettingModal={() => setShowGroupSettingModal(true)} 
                onOpenVoiceSettingsModal={() => setShowVoiceSettingsModal(true)} onOpenDevLog={() => setShowDevLogSheet(!showDevLogSheet)}
                showDevLogButton={showDevFeatures} disabled={isLoading || isShuffling} isTtsAvailable={isTtsSystemAvailable} 
              />
          </footer>
      </div>
      
      {showDevLogSheet && <aside className="w-full max-w-xl h-full flex-shrink-0 border-l border-slate-700/80"><DevLogSheet history={devLog} onClose={() => setShowDevLogSheet(false)} /></aside>}
      {isShuffling && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm"><CardShuffleAnimation colorClasses={shuffleColorClasses} /></div>}
      {showCustomDeckModal && <CustomDeckModal onClose={() => {setShowCustomDeckModal(false); setEditingCustomDeck(null);}} onSave={() => {}} initialData={editingCustomDeck || undefined} interactionsDisabled={isLoading || isShuffling} />}
      {showVoiceSettingsModal && <VoiceSettingsModal currentVoice={selectedVoiceName} currentLanguage={selectedLanguageCode} isMuted={isAudioMuted} onVoiceChange={(v) => setSelectedVoiceName(v)} onLanguageChange={(l) => setSelectedLanguageCode(l)} onMuteChange={(m) => setIsAudioMuted(m)} onClose={() => setShowVoiceSettingsModal(false)} voicePersonas={CURATED_VOICE_PERSONAS} isSystemAvailable={isTtsSystemAvailable} onRetryAvailabilityCheck={handleRetryConnection} />}
      {showDeckInfoModal && itemForInfoModal && <DeckInfoModal item={itemForInfoModal} onClose={() => setShowDeckInfoModal(false)} />}
      {showGroupSettingModal && <GroupSettingModal currentSetting={selectedGroupSetting} onSettingChange={(s) => setSelectedGroupSetting(s)} onClose={() => setShowGroupSettingModal(false)} groupSettingsOptions={GROUP_SETTINGS} disabled={isLoading || isShuffling} ageFilters={ageFilters} onAgeFilterChange={(af) => setAgeFilters(af)} intensityFilters={intensityFilters} onIntensityFilterChange={(ifl) => setIntensityFilters(ifl)} />}
    </div>
  );
}

export default App;
