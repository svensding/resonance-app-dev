
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
  const [selectedLanguageCode, setSelectedLanguageCode] = useState<LanguageCode>("en-US");
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [showVoiceSettingsModal, setShowVoiceSettingsModal] = useState<boolean>(false);
  const [ageFilters, setAgeFilters] = useState<AgeFilters>(() => loadFromLocalStorage<AgeFilters>(LOCALSTORAGE_KEYS.AGE_FILTERS, { adults: true, teens: false, kids: false }));
  const [intensityFilters, setIntensityFilters] = useState<IntensityLevel[]>(() => loadFromLocalStorage<IntensityLevel[]>(LOCALSTORAGE_KEYS.INTENSITY_FILTERS, ALL_INTENSITY_LEVELS));
  
  // New State for System Capability
  const [isTtsSystemAvailable, setIsTtsSystemAvailable] = useState<boolean>(true);
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(false);

  const [showDevLogSheet, setShowDevLogSheet] = useState(false);
  const [devLog, setDevLog] = useState<DevLogEntry[]>([]);
  const [showDevFeatures, setShowDevFeatures] = useState(false);
  const devModeActivated = useRef(false);

  const addLogEntry = useCallback((entry: DevLogEntry) => {
      setDevLog(prev => [...prev, entry]);
  }, []);

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
      const checkDevMode = () => {
          if (devModeActivated.current) return;

          const hasSvenDev = participants.some(p => p.name.toLowerCase().trim() === 'svendev');
          const hasDevHash = window.location.hash === '#devlog';

          if (hasSvenDev || hasDevHash) {
              setShowDevFeatures(true);
              devModeActivated.current = true;
          }
      };

      checkDevMode(); // Initial check

      window.addEventListener('hashchange', checkDevMode);
      return () => window.removeEventListener('hashchange', checkDevMode);
  }, [participants]);


  useEffect(() => {
    console.log("App mounted. Resonance (Gemini 3 Update - Complete Waterfall).");
    if (!process.env.API_KEY) {
      setApiKeyMissing(true);
      setError("API_KEY for Gemini is not configured.");
    } else {
        performHealthCheck(addLogEntry).then(status => {
            if (!status.available) {
                // Instead of a hard error, switch to Offline Mode if quota or other issues
                setIsOfflineMode(true);
                // Clear any previous general error if we are switching to offline mode handling
                setError(null);
            } else {
                setIsOfflineMode(false);
                setError(null);
            }
            setIsTtsSystemAvailable(status.ttsAvailable);
            if (!status.ttsAvailable) {
                console.warn("TTS System unavailable (likely quota exhausted). Voice features automatically disabled.");
            }
        });
    }

    const loadedDecks = loadFromLocalStorage<CustomThemeData[]>(LOCALSTORAGE_KEYS.CUSTOM_DECKS, []);
    setCustomDecks(loadedDecks);

    const loadedVoice = loadFromLocalStorage<VoiceName>(LOCALSTORAGE_KEYS.VOICE_NAME, DEFAULT_VOICE_NAME);
    setSelectedVoiceName(loadedVoice);
    const loadedLang = loadFromLocalStorage<LanguageCode>(LOCALSTORAGE_KEYS.LANGUAGE_CODE, "en-US");
    setSelectedLanguageCode(loadedLang);
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
    };
  }, [addLogEntry]);

  const handleStopAudio = useCallback(() => {
    stopSpeechServicePlayback();
    setActiveCardAudio(null);
  }, []);

  const handleRetryConnection = useCallback(async () => {
      const status = await performHealthCheck(addLogEntry);
      if (status.available) {
          setIsOfflineMode(false);
      } else {
          setIsOfflineMode(true);
      }
      setIsTtsSystemAvailable(status.ttsAvailable);
      return status.available;
  }, [addLogEntry]);

    const handlePlayAudioForMainPrompt = useCallback(async (
      card: DrawnCardData
    ) => {
        handleStopAudio();
        // Immediately try to resume context on user interaction (if this comes from a click)
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
            // Fallback to browser synthesis if Gemini TTS failed or text is available but no TTS instructions
            speakText(card.text, selectedLanguageCode, isAudioMuted, onPlaybackEnd);
        } else {
            setActiveCardAudio(null);
        }
    }, [isAudioMuted, selectedLanguageCode, handleStopAudio, addLogEntry, isTtsSystemAvailable, isOfflineMode]);

  const handleFetchAndPlayCardBackAudio = useCallback(async (cardId: string, textToSpeak: string) => {
    handleStopAudio();
    // Resume context to ensure playback is authorized
    await resumeAudioContext();

    // Guard: If system TTS is down, don't attempt fetch
    if (!isTtsSystemAvailable || isOfflineMode) {
        console.warn("TTS System is unavailable or in Offline Mode. Skipping card back audio generation.");
        return;
    }

    setActiveCardAudio({ cardId, type: 'notes' });

    try {
        const cardInHistory = drawnCardHistory.find(c => c.id === cardId || c.activeFollowUpCard?.id === cardId);
        const cardToUse = cardInHistory?.id === cardId ? cardInHistory : cardInHistory?.activeFollowUpCard;
        if (!cardToUse) throw new Error("Card not found in history");
        
        const deck = !cardToUse.themedDeckId.startsWith("CUSTOM_")
            ? getThemedDeckById(cardToUse.themedDeckId as ThemedDeck['id'])
            : getCustomDeckById(cardToUse.themedDeckId as CustomThemeId, customDecks);
        const styleDirective = getStyleDirectiveForCard(selectedVoiceName, true, deck);
        
        const fullPrompt = `${styleDirective} "${textToSpeak}"`;
        const audioResult = await generateAudioForText(fullPrompt, selectedVoiceName, null);
        
        addLogEntry({
            type: 'tts',
            requestTimestamp: audioResult.requestTimestamp,
            responseTimestamp: audioResult.responseTimestamp,
            data: { ...audioResult.logData, error: audioResult.error }
        });

        if (audioResult.error || !audioResult.audioData || !audioResult.audioMimeType) {
            throw new Error(audioResult.error || "Failed to generate audio audio.");
        }
        
        const onPlaybackEnd = () => setActiveCardAudio(null);
        playAudioData(audioResult.audioData, audioResult.audioMimeType, isAudioMuted, onPlaybackEnd);

    } catch (err: any) {
        console.error("Error fetching or playing card back audio:", err);
        setError("Could not generate guidance audio.");
        setActiveCardAudio(null);
    }
  }, [selectedVoiceName, isAudioMuted, drawnCardHistory, handleStopAudio, addLogEntry, customDecks, isTtsSystemAvailable, isOfflineMode]);
  
  const handleDrawNewCard = useCallback(async (itemId: ThemeIdentifier | "RANDOM" | `CATEGORY_${string}`, options?: { isRedraw?: boolean }) => {
    if (isLoading || isShuffling) return;

    // --- CRITICAL AUDIO FIX ---
    // Initialize/Resume AudioContext synchronously within the user event handler
    await resumeAudioContext();

    const performDraw = async () => {
        handleStopAudio();
        setIsLoading(true);
        setIsShuffling(true);
        setError(null);

        let chosenDeck: ThemedDeck | CustomThemeData | undefined;

        try {
            let colorsForShuffle: string[] = [];
            
            // --- OFFLINE MODE HANDLER ---
            if (isOfflineMode) {
                // Simulate network delay for better UX
                await new Promise(resolve => setTimeout(resolve, 800));
                
                const offlineCard = drawOfflineCard();
                const activeParticipant = participants.find(p => p.id === activeParticipantId);
                offlineCard.drawnForParticipantId = activeParticipantId;
                offlineCard.drawnForParticipantName = activeParticipant?.name || null;
                
                // Color for offline shuffle
                colorsForShuffle = [getDisplayDataForCard(OFFLINE_DECK.id, customDecks).colorClass];
                setShuffleColorClasses(colorsForShuffle); // Trigger animation color

                setDrawnCardHistory(prev => [offlineCard, ...prev.slice(0, MAX_HISTORY_WITH_AUDIO - 1)]);
                
                // Next turn logic
                if (participants.length > 1 && !options?.isRedraw && !offlineCard.isTimed) {
                    const currentIndex = participants.findIndex(p => p.id === activeParticipantId);
                    const nextIndex = (currentIndex + 1) % participants.length;
                    setActiveParticipantId(participants[nextIndex].id);
                }
                
                setIsShuffling(false);
                setIsLoading(false);
                return; // Done
            }

            // --- ONLINE MODE HANDLER ---
            const visibleDecks = getVisibleDecks(selectedGroupSetting, ageFilters, intensityFilters, showDevFeatures);

            if (itemId === "RANDOM") {
                if (visibleDecks.length === 0) throw new Error(`No suitable random decks available for the current settings.`);
                chosenDeck = visibleDecks[Math.floor(Math.random() * visibleDecks.length)];
                 colorsForShuffle = visibleDecks
                    .map(d => getDisplayDataForCard(d.id, customDecks).colorClass)
                    .sort(() => 0.5 - Math.random()) 
                    .slice(0, 6);
            } else if (itemId.startsWith("CATEGORY_")) {
                const categoryId = itemId.replace("CATEGORY_", "");
                const decksInCategory = visibleDecks.filter(d => d.category === categoryId);
                if (decksInCategory.length === 0) throw new Error(`No suitable decks available for the category "${categoryId}".`);
                chosenDeck = decksInCategory[Math.floor(Math.random() * decksInCategory.length)];
                colorsForShuffle = [getDisplayDataForCard(chosenDeck.id, customDecks).colorClass];
            } else if (itemId.startsWith("CUSTOM_")) {
                chosenDeck = getCustomDeckById(itemId as CustomThemeId, customDecks) || undefined;
                if (!chosenDeck) throw new Error("Custom deck not found");
                colorsForShuffle = [chosenDeck.colorClass];
            } else {
                chosenDeck = getThemedDeckById(itemId as ThemedDeck['id']) || undefined;
                if (!chosenDeck) throw new Error("Deck not found");
                colorsForShuffle = [getDisplayDataForCard(chosenDeck.id, customDecks).colorClass];
            }
            if (!chosenDeck) throw new Error("Could not select a deck to draw from.");

            setShuffleColorClasses(colorsForShuffle);
        
            const activePName = participants.find(p => p.id === activeParticipantId)?.name || null;
            
            // Determine effective TTS capability for this draw
            const shouldGenerateAudio = !isAudioMuted && isTtsSystemAvailable;

            // --- 1. GENERATE TEXT ---
            // Pass shouldGenerateAudio to tell the LLM whether to include TTS instructions/fields
            const frontResult = await generateCardFront(
                chosenDeck, selectedGroupSetting, participants.length, participants.map(p => p.name).filter(Boolean), activePName,
                ageFilters, selectedVoiceName, selectedLanguageCode, drawnCardHistory.length, addLogEntry, shouldGenerateAudio, { disliked: options?.isRedraw ?? false }
            );

            addLogEntry({
                type: 'chat-front',
                requestTimestamp: frontResult.requestTimestamp,
                responseTimestamp: frontResult.responseTimestamp,
                data: { input: frontResult.inputPrompt, output: frontResult.rawLlmOutput, error: frontResult.error }
            });
            
            if (frontResult.error || !frontResult.text) {
                // If specific quota error occurs during draw, switch to offline mode
                if (frontResult.error?.includes('429') || frontResult.error?.includes('quota') || frontResult.error?.includes('RESOURCE_EXHAUSTED')) {
                    setIsOfflineMode(true);
                    throw new Error("Service is currently busy. Switching to Offline Mode.");
                }
                throw new Error(frontResult.error || "The AI returned an incomplete or invalid response. Please try drawing again.");
            }

            // --- 2. GENERATE AUDIO (IF ENABLED & SYSTEM CAPABLE) ---
            // We wait for this BEFORE rendering to ensure simultaneous appearance
            let generatedAudioData: string | null = null;
            let generatedAudioMimeType: string | null = null;

            if (shouldGenerateAudio) {
                // If text generated TTS input, use it. Otherwise construct it (fallback logic, though LLM should provide it if enabled).
                const audioPromise = (frontResult.ttsInput && frontResult.ttsInput.trim().length > 0 && frontResult.ttsVoice)
                    ? generateAudioForText(frontResult.ttsInput, frontResult.ttsVoice, null)
                    : (frontResult.text ? generateAudioForText(`${getStyleDirectiveForCard(selectedVoiceName, false, 'themes' in chosenDeck ? chosenDeck : getCustomDeckById(chosenDeck.id, customDecks))} "${frontResult.text}"`, selectedVoiceName, null) : Promise.resolve(null));

                const audioGenResult = await audioPromise; // WAIT HERE

                if (audioGenResult) {
                    addLogEntry({ type: 'tts', requestTimestamp: audioGenResult.requestTimestamp, responseTimestamp: audioGenResult.responseTimestamp, data: { ...audioGenResult.logData, error: audioGenResult.error, context: 'Pre-Render Audio Load' }});
                    
                    if (audioGenResult.audioData && audioGenResult.audioMimeType) {
                        generatedAudioData = audioGenResult.audioData;
                        generatedAudioMimeType = audioGenResult.audioMimeType;
                    }
                }
            }

            // --- 3. RENDER STATE (TEXT + AUDIO READY) ---
            const newCardId = `card-${Date.now()}`;
            const activeParticipant = participants.find(p => p.id === activeParticipantId);
            const isTimed = !!frontResult.reflectionText; 

            const newCard: DrawnCardData = {
                id: newCardId,
                themedDeckId: chosenDeck.id,
                feedback: null,
                timestamp: Date.now(),
                drawnForParticipantId: activeParticipantId,
                drawnForParticipantName: activeParticipant?.name || null,
                isFaded: false,
                text: frontResult.text,
                ttsInput: frontResult.ttsInput,
                ttsVoice: frontResult.ttsVoice,
                audioData: generatedAudioData, 
                audioMimeType: generatedAudioMimeType, 
                cardBackNotesText: null, // Placeholder
                isTimed: isTimed,
                hasFollowUp: isTimed,
                timerDuration: frontResult.timerDuration,
                followUpPromptText: frontResult.reflectionText || null,
                followUpAudioData: null,
                followUpAudioMimeType: null,
                isCompletedActivity: false,
                isFollowUp: false,
                activeFollowUpCard: null,
            };
            
            // Update History immediately so the user sees the card
            setDrawnCardHistory(prev => [newCard, ...prev.slice(0, MAX_HISTORY_WITH_AUDIO - 1)]);
            setIsShuffling(false); // Stop animation
            setIsLoading(false); // Unlock UI

            // Move to next participant if applicable
            if (participants.length > 1 && !options?.isRedraw && !newCard.isTimed) {
                const currentIndex = participants.findIndex(p => p.id === activeParticipantId);
                const nextIndex = (currentIndex + 1) % participants.length;
                setActiveParticipantId(participants[nextIndex].id);
            }

            // Play Audio Immediately if we have it
            if (generatedAudioData && generatedAudioMimeType && !isAudioMuted) {
                 playAudioData(generatedAudioData, generatedAudioMimeType, isAudioMuted, () => setActiveCardAudio(null));
                 setActiveCardAudio({ cardId: newCardId, type: 'prompt' });
            }

            // --- 4. BACKGROUND TASKS: FOLLOW-UP AUDIO & BACK ---

            // Task B: Generate Follow-up Audio (If applicable AND system capable)
            if (frontResult.reflectionText && shouldGenerateAudio) {
                 generateAudioForText(
                    `"${frontResult.reflectionText}"`, 
                    selectedVoiceName, 
                    getStyleDirectiveForCard(selectedVoiceName, false, 'themes' in chosenDeck ? chosenDeck : getCustomDeckById(chosenDeck.id, customDecks))
                  ).then(res => {
                      if (res && res.audioData) {
                          setDrawnCardHistory(prev => prev.map(c => 
                                c.id === newCardId ? { ...c, followUpAudioData: res.audioData, followUpAudioMimeType: res.audioMimeType } : c
                            ));
                      }
                  });
            }

            // Task C: Generate Card Back
            generateCardBack(frontResult.text, chosenDeck).then(backResult => {
                addLogEntry({ type: 'chat-back', requestTimestamp: backResult.requestTimestamp, responseTimestamp: backResult.responseTimestamp, data: { input: backResult.inputPrompt, output: backResult.rawLlmOutput, error: backResult.error, context: 'Background Back Load' }});
                if (backResult.cardBackNotesText) {
                    setDrawnCardHistory(prev => prev.map(c => 
                        c.id === newCardId ? { ...c, cardBackNotesText: backResult.cardBackNotesText } : c
                    ));
                }
            }).catch(e => console.error("Background card back generation failed", e));


        } catch (err: any) {
            console.error("Error drawing card:", err.message ? JSON.stringify(err.message) : JSON.stringify(err));
            setError(err.message || "An unknown error occurred while drawing the card.");
            setIsShuffling(false);
            setIsLoading(false);
        } finally {
            setShuffleColorClasses([]);
        }
    };
    
    await performDraw();

  }, [isLoading, isShuffling, participants, activeParticipantId, customDecks, selectedVoiceName, selectedLanguageCode, handleStopAudio, isAudioMuted, selectedGroupSetting, ageFilters, intensityFilters, drawnCardHistory.length, addLogEntry, showDevFeatures, isTtsSystemAvailable, isOfflineMode]);

  useEffect(() => {
    const sourceCard = drawnCardHistory.find(c =>
      c.isCompletedActivity && c.hasFollowUp && c.followUpPromptText && !c.activeFollowUpCard
    );

    if (!sourceCard || isLoading || isShuffling) {
      return;
    }

    const generateFollowUp = async (cardToUpdate: DrawnCardData) => {
      handleStopAudio(); 
      setIsLoading(true);
      try {
        const followUpText = cardToUpdate.followUpPromptText!;
        const themeItem = getThemedDeckById(cardToUpdate.themedDeckId as ThemedDeck['id']) || getCustomDeckById(cardToUpdate.themedDeckId as CustomThemeId, customDecks);
        
        if (!themeItem && !isOfflineMode) {
          setError("Could not find the theme for the follow-up prompt.");
          setIsLoading(false);
          return;
        }

        const activeP = participants.find(p => p.id === activeParticipantId);
        const newId = `card-${Date.now()}`;

        const placeholderFollowUpCard: DrawnCardData = {
          id: newId,
          themedDeckId: cardToUpdate.themedDeckId,
          feedback: null,
          timestamp: Date.now(),
          drawnForParticipantId: activeP?.id || null,
          drawnForParticipantName: activeP?.name || null,
          isFaded: false,
          text: followUpText,
          ttsInput: null, 
          ttsVoice: null,
          audioData: cardToUpdate.followUpAudioData, 
          audioMimeType: cardToUpdate.followUpAudioMimeType,
          cardBackNotesText: null,
          isTimed: false, hasFollowUp: false, timerDuration: null, followUpPromptText: null,
          isCompletedActivity: false, isFollowUp: true, activeFollowUpCard: null,
          followUpAudioData: null, followUpAudioMimeType: null,
        };
        
        setDrawnCardHistory(prev => prev.map(c => c.id === cardToUpdate.id ? { ...c, activeFollowUpCard: placeholderFollowUpCard } : c));
        
        // Immediate play of cached audio if available
        if (!isAudioMuted && placeholderFollowUpCard.audioData && placeholderFollowUpCard.audioMimeType) {
             handlePlayAudioForMainPrompt(placeholderFollowUpCard);
        }

        // Background fetch for Card Back of follow-up (Only if Online)
        if (!isOfflineMode && themeItem) {
            generateCardBack(followUpText, themeItem, cardToUpdate.text).then(backResult => {
                if (backResult) addLogEntry({ type: 'chat-back', requestTimestamp: backResult.requestTimestamp, responseTimestamp: backResult.responseTimestamp, data: { input: backResult.inputPrompt, output: backResult.rawLlmOutput, error: backResult.error } });
                
                setDrawnCardHistory(prev => prev.map(c =>
                    c.id === cardToUpdate.id && c.activeFollowUpCard?.id === newId
                        ? { ...c, activeFollowUpCard: { ...c.activeFollowUpCard!, cardBackNotesText: backResult.cardBackNotesText } } 
                        : c
                ));
            });
        }

        if (participants.length > 1) {
          const currentIndex = participants.findIndex(p => p.id === activeParticipantId);
          const nextIndex = (currentIndex + 1) % participants.length;
          setActiveParticipantId(participants[nextIndex].id);
        }
      } catch (err: any) {
        console.error("Error generating follow-up card:", err);
        setError("Failed to generate the follow-up card.");
        setDrawnCardHistory(prev => prev.map(c => c.id === cardToUpdate.id ? { ...c, activeFollowUpCard: null } : c));
      } finally {
        setIsLoading(false);
      }
    };

    generateFollowUp(sourceCard);

  }, [drawnCardHistory, isLoading, isShuffling, customDecks, isAudioMuted, participants, activeParticipantId, addLogEntry, handlePlayAudioForMainPrompt, handleStopAudio, isOfflineMode]);


  const handleTimerEnd = useCallback((completedCardId: string) => {
      setDrawnCardHistory(prev => prev.map(c => 
          c.id === completedCardId ? { ...c, isCompletedActivity: true } : c
      ));
  }, []);
  
  const handleRedoTimedActivity = useCallback((cardId: string) => {
    handleStopAudio();
    setDrawnCardHistory(prev => prev.map(c => 
      c.id === cardId 
        ? { ...c, isCompletedActivity: false, activeFollowUpCard: null } 
        : c
    ));
  }, [handleStopAudio]);

  const handleLike = useCallback(async (cardId: string) => {
    const cardToUpdate = drawnCardHistory.find(c => c.id === cardId || c.activeFollowUpCard?.id === cardId);
    if (!cardToUpdate) return;
  
    setDrawnCardHistory(prev => prev.map(card => {
      if (card.id === cardToUpdate.id) {
        const feedback = 'liked';
        if (card.activeFollowUpCard) {
            return { ...card, feedback, activeFollowUpCard: { ...card.activeFollowUpCard, feedback }};
        }
        return { ...card, feedback };
      }
      return card;
    }));
  
    let feedbackText = "";
    if (cardToUpdate.activeFollowUpCard) {
      feedbackText = `Parent Card: "${cardToUpdate.text}"\nFollow-up Card: "${cardToUpdate.activeFollowUpCard.text}"`;
    } else {
      feedbackText = cardToUpdate.text;
    }

    if (feedbackText && !isOfflineMode) {
      await sendFeedbackToChat(feedbackText, 'liked', addLogEntry);
    }
  }, [drawnCardHistory, addLogEntry, isOfflineMode]);
  
  const handleDislike = useCallback(async (cardId: string) => {
    if (isLoading || isShuffling) return;

    const cardToUpdate = drawnCardHistory.find(c => c.id === cardId || c.activeFollowUpCard?.id === cardId);
    if (!cardToUpdate) return;
    
    const isFollowUp = cardToUpdate.activeFollowUpCard?.id === cardId;
    const isNewestCard = cardToUpdate.id === drawnCardHistory[0]?.id && !drawnCardHistory[0].isFaded;

    setDrawnCardHistory(prev => prev.map(card => {
      if (card.id === cardToUpdate.id) {
          const feedback = 'disliked';
          if (card.activeFollowUpCard) {
              return { ...card, feedback, activeFollowUpCard: { ...card.activeFollowUpCard, feedback }};
          }
          return { ...card, feedback };
      }
      return card;
    }));
    
    let feedbackText = "";
    if (cardToUpdate.activeFollowUpCard) {
      feedbackText = `Parent Card: "${cardToUpdate.text}"\nFollow-up Card: "${cardToUpdate.activeFollowUpCard.text}"`;
    } else {
      feedbackText = cardToUpdate.text;
    }
    
    if (feedbackText && !isOfflineMode) {
        await sendFeedbackToChat(feedbackText, 'disliked', addLogEntry);
    }
    
    if (isNewestCard && !isFollowUp) {
        setDrawnCardHistory(prev => prev.map(card => 
            card.id === cardToUpdate.id ? { ...card, isFaded: true, activeFollowUpCard: card.activeFollowUpCard ? { ...card.activeFollowUpCard, isFaded: true } : null } : card
        ));

        await new Promise(resolve => setTimeout(resolve, 300));
        await handleDrawNewCard("RANDOM", { isRedraw: true });

    } else if (isFollowUp) {
        setDrawnCardHistory(prev => prev.map(card => {
            if (card.activeFollowUpCard?.id === cardId) {
                return { ...card, isFaded: true, activeFollowUpCard: { ...card.activeFollowUpCard, isFaded: true }};
            }
            return card;
        }));
    }
  }, [drawnCardHistory, isLoading, isShuffling, handleDrawNewCard, addLogEntry, isOfflineMode]);

  const handleAddCustomDeck = () => {
    if (isLoading) return;
    setEditingCustomDeck(null);
    setShowCustomDeckModal(true);
  };
  
  const handleEditCustomDeck = (deck: CustomThemeData) => {
    if (isLoading) return;
    setEditingCustomDeck(deck);
    setShowCustomDeckModal(true);
  };

  const handleSaveCustomDeck = (
    name: string, 
    description: string, 
    options: {
        themes: CoreTheme[],
        cardTypes: CardType[],
        intensity: IntensityLevel[]
    }
  ) => {
    if (editingCustomDeck) {
      const updatedDecks = customDecks.map(deck =>
        deck.id === editingCustomDeck.id ? { ...deck, name, description, ...options } : deck
      );
      setCustomDecks(updatedDecks);
      saveToLocalStorage(LOCALSTORAGE_KEYS.CUSTOM_DECKS, updatedDecks);
    } else {
      const newDeck: CustomThemeData = {
        id: `CUSTOM_${Date.now()}`, name, description, ...options,
        colorClass: CUSTOM_DECK_COLOR_PALETTE[customDecks.length % CUSTOM_DECK_COLOR_PALETTE.length],
      };
      const updatedDecks = [...customDecks, newDeck];
      setCustomDecks(updatedDecks);
      saveToLocalStorage(LOCALSTORAGE_KEYS.CUSTOM_DECKS, updatedDecks);
    }
    setShowCustomDeckModal(false);
    setEditingCustomDeck(null);
  };
  
  const handleShowDeckInfo = (itemId: ThemeIdentifier) => {
    if (itemId.startsWith("CUSTOM_")) {
        const item = getCustomDeckById(itemId as CustomThemeId, customDecks);
        if (item) setItemForInfoModal(item);
    } else {
        const item = getThemedDeckById(itemId as ThemedDeck['id']);
        if (item) setItemForInfoModal(item);
    }
    setShowDeckInfoModal(true);
  };

  const handleRemoveParticipant = (participantId: string) => {
    setParticipants(prev => {
        const newParticipants = prev.filter(p => p.id !== participantId);
        if (activeParticipantId === participantId) {
            setActiveParticipantId(newParticipants.length > 0 ? newParticipants[0].id : null);
        }
        if (newParticipants.length === 0) {
            const defaultParticipant = { id: `participant-${Date.now()}`, name: '' };
            setActiveParticipantId(defaultParticipant.id);
            return [defaultParticipant];
        }
        return newParticipants;
    });
  };
  
  const handleVoiceChange = (voice: VoiceName) => {
    setSelectedVoiceName(voice);
    saveToLocalStorage(LOCALSTORAGE_KEYS.VOICE_NAME, voice);
  };
  const handleLanguageChange = (language: LanguageCode) => {
    setSelectedLanguageCode(language);
    saveToLocalStorage(LOCALSTORAGE_KEYS.LANGUAGE_CODE, language);
  };
  const handleMuteChange = (muted: boolean) => {
    setIsAudioMuted(muted);
    saveToLocalStorage(LOCALSTORAGE_KEYS.IS_MUTED, muted);
    if (muted) {
      handleStopAudio();
    }
  };
  const handleGroupSettingChange = (setting: SocialContext) => {
    setSelectedGroupSetting(setting);
    saveToLocalStorage(LOCALSTORAGE_KEYS.GROUP_SETTING, setting);
  };
  const handleAgeFilterChange = (newFilters: AgeFilters) => {
    if (!newFilters.adults && !newFilters.teens && !newFilters.kids) {
        setAgeFilters({ adults: true, teens: false, kids: false });
    } else {
        setAgeFilters(newFilters);
        if ((newFilters.kids || newFilters.teens) && selectedGroupSetting === 'ROMANTIC') {
            setSelectedGroupSetting('FRIENDS');
            saveToLocalStorage(LOCALSTORAGE_KEYS.GROUP_SETTING, 'FRIENDS');
        }
    }
  };

  const handleOpenDevLog = () => {
    setShowDevLogSheet(prev => !prev);
  };


  return (
    <div 
      className="h-full w-full flex bg-slate-900 text-slate-200 overflow-hidden" 
      style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}
    >
      <div className="flex-1 flex flex-col relative min-w-0">
          <header 
            className="flex-shrink-0 z-20 w-full bg-slate-900/80 backdrop-blur-sm shadow-lg h-28 md:h-32"
          >
            <ThemeDeckSelection 
              onDraw={handleDrawNewCard} isDrawingInProgress={isLoading || isShuffling} interactionsDisabled={isLoading || isShuffling}
              customDecks={customDecks} onAddCustomDeck={handleAddCustomDeck}
              onEditCustomDeck={handleEditCustomDeck} onShowDeckInfo={handleShowDeckInfo}
              groupSetting={selectedGroupSetting}
              ageFilters={ageFilters}
              intensityFilters={intensityFilters}
              participants={participants}
              showAllDecks={showDevFeatures}
              isOfflineMode={isOfflineMode}
              onRetryConnection={handleRetryConnection}
            />
          </header>
          
          <main 
            className="flex-grow w-full overflow-y-auto overflow-x-hidden scrollbar-thin flex flex-col items-center justify-start p-4 md:p-6"
          >
            {apiKeyMissing ? (
                <div className="flex justify-center items-center h-full"><ApiKeyMessage /></div>
            ) : error ? (
                <div className="flex justify-center items-center p-4">
                    <div className="bg-red-800/80 border border-red-600 text-red-100 px-4 py-3 rounded-lg shadow-md max-w-lg w-full text-center" role="alert">
                      <strong className="font-bold block sm:inline">An error occurred:</strong>
                      <span className="block sm:inline ml-2">{error}</span>
                      <button onClick={() => setError(null)} className="ml-4 px-2 py-1 bg-red-700 rounded-md hover:bg-red-600">Dismiss</button>
                    </div>
                </div>
            ) : (
              <DrawnCardsHistoryView
                history={drawnCardHistory} 
                onLike={handleLike} onDislike={handleDislike}
                onPlayAudioForMainPrompt={handlePlayAudioForMainPrompt}
                onFetchAndPlayCardBackAudio={handleFetchAndPlayCardBackAudio}
                onTimerEnd={handleTimerEnd}
                onRedoTimedActivity={handleRedoTimedActivity}
                customDecks={customDecks}
                activeCardAudio={activeCardAudio} onStopAudio={handleStopAudio}
                isDrawingInProgress={isLoading || isShuffling}
              />
            )}
          </main>

          <footer 
            className="flex-shrink-0 z-20 w-full bg-slate-900/80 backdrop-blur-sm"
          >
              <BottomToolbar 
                participants={participants} setParticipants={setParticipants}
                activeParticipantId={activeParticipantId} setActiveParticipantId={setActiveParticipantId}
                onRemoveParticipant={handleRemoveParticipant} groupSetting={selectedGroupSetting}
                onOpenGroupSettingModal={() => setShowGroupSettingModal(true)} 
                onOpenVoiceSettingsModal={() => setShowVoiceSettingsModal(true)}
                onOpenDevLog={handleOpenDevLog}
                showDevLogButton={showDevFeatures}
                disabled={isLoading || isShuffling}
                isTtsAvailable={isTtsSystemAvailable} 
              />
          </footer>
      </div>
      
      {showDevLogSheet && (
          <aside className="w-full max-w-sm sm:max-w-md md:max-w-lg lg:max-w-xl h-full flex-shrink-0 border-l border-slate-700/80">
              <DevLogSheet 
                  history={devLog} 
                  onClose={() => setShowDevLogSheet(false)} 
              />
          </aside>
      )}

      {isShuffling && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
             <CardShuffleAnimation colorClasses={shuffleColorClasses} />
          </div>
      )}
      {showCustomDeckModal && (
        <CustomDeckModal 
          onClose={() => setShowCustomDeckModal(false)}
          onSave={handleSaveCustomDeck}
          initialData={editingCustomDeck || undefined}
          interactionsDisabled={isLoading || isShuffling}
        />
      )}
      {showVoiceSettingsModal && (
        <VoiceSettingsModal 
          currentVoice={selectedVoiceName} currentLanguage={selectedLanguageCode} isMuted={isAudioMuted}
          onVoiceChange={handleVoiceChange} onLanguageChange={handleLanguageChange} onMuteChange={handleMuteChange}
          onClose={() => setShowVoiceSettingsModal(false)} voicePersonas={CURATED_VOICE_PERSONAS}
          isSystemAvailable={isTtsSystemAvailable} 
          onRetryAvailabilityCheck={handleRetryConnection}
        />
      )}
      {showDeckInfoModal && itemForInfoModal && (
        <DeckInfoModal item={itemForInfoModal} onClose={() => setShowDeckInfoModal(false)} />
      )}
      {showGroupSettingModal && (
        <GroupSettingModal 
          currentSetting={selectedGroupSetting} onSettingChange={handleGroupSettingChange}
          onClose={() => setShowGroupSettingModal(false)} groupSettingsOptions={GROUP_SETTINGS} disabled={isLoading || isShuffling}
          ageFilters={ageFilters} onAgeFilterChange={handleAgeFilterChange}
          intensityFilters={intensityFilters} onIntensityFilterChange={setIntensityFilters}
        />
      )}
    </div>
  );
}

export default App;
