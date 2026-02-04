
import { GoogleGenAI, GenerateContentResponse, Chat, Content, Type, Schema, Modality } from "@google/genai";
import { DevLogEntry } from "../components/DevLogSheet";

const API_KEY = process.env.API_KEY;
let ai: GoogleGenAI | null = null;
let chatSessions: { [sessionId: string]: Chat } = {};
let lastActiveSessionId: string | null = null;

if (API_KEY) {
  try {
    ai = new GoogleGenAI({ apiKey: API_KEY });
  } catch (error) {
    console.error("Failed to initialize GoogleGenAI:", error);
  }
}

// Optimization: Use Flash for speed
export const PRIMARY_TEXT_GENERATION_MODEL = 'gemini-3-flash-preview';
// Updated fallback to a valid model identifier
export const FALLBACK_TEXT_GENERATION_MODEL = 'gemini-2.0-flash'; 
const TTS_MODEL = 'gemini-2.5-flash-preview-tts'; 
const GENERATION_TIMEOUT_MS = 45000; 

let activeTextModel = PRIMARY_TEXT_GENERATION_MODEL;

const switchToFallbackModel = () => {
    if (activeTextModel === PRIMARY_TEXT_GENERATION_MODEL) {
        console.warn(`Switching to fallback model: ${FALLBACK_TEXT_GENERATION_MODEL}`);
        activeTextModel = FALLBACK_TEXT_GENERATION_MODEL;
    }
};

export const resetChatSession = () => {
    chatSessions = {};
    lastActiveSessionId = null;
    console.log("All chat sessions have been reset.");
};

export const getChatSessionHistory = () => {
    return Object.keys(chatSessions).map(key => ({ sessionId: key }));
};

export const performHealthCheck = async (addLogEntry?: (entry: DevLogEntry) => void): Promise<{ available: boolean; activeModel: string; ttsAvailable: boolean; error?: string; isQuotaError?: boolean }> => {
    if (!ai) {
        const error = "Gemini AI not initialized.";
        addLogEntry?.({ type: 'health-check', requestTimestamp: Date.now(), responseTimestamp: Date.now(), data: { input: "Health Check Start", output: "Failed: AI not initialized", error } });
        return { available: false, activeModel: '', ttsAvailable: false, error };
    }

    const log = (status: string, model: string, error?: string) => {
        addLogEntry?.({ type: 'health-check', requestTimestamp: Date.now(), responseTimestamp: Date.now(), data: { input: `Checking model: ${model}`, output: status, error } });
    };
    
    let ttsAvailable = false;
    const checkTTS = async () => {
        if (!ai) return;
        try {
            await ai.models.generateContent({
                model: TTS_MODEL,
                contents: {
                    role: 'user',
                    parts: [{ text: 'healthcheck' }]
                }, 
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                          prebuiltVoiceConfig: { voiceName: DEFAULT_VOICE_NAME },
                        },
                    },
                } as any,
            });
            log('Success', TTS_MODEL);
            ttsAvailable = true;
        } catch (e: any) {
            console.warn(`Health check failed for TTS model (${TTS_MODEL}). TTS features will be disabled. Error: ${e.message}`);
            if (e.message?.includes('429') || e.message?.includes('404') || e.message?.includes('RESOURCE_EXHAUSTED')) {
                 log('Failure (Quota/Missing)', TTS_MODEL, e.message);
            } else {
                 log('Failure (General)', TTS_MODEL, e.message);
            }
            ttsAvailable = false;
        }
    };

    try {
        await ai.models.generateContent({ model: PRIMARY_TEXT_GENERATION_MODEL, contents: [{ role: 'user', parts: [{ text: 'healthcheck' }] }] });
        activeTextModel = PRIMARY_TEXT_GENERATION_MODEL;
        const statusMessage = `Health check PASSED. Active model: ${activeTextModel}`;
        console.log(statusMessage);
        log('Success', PRIMARY_TEXT_GENERATION_MODEL, undefined);
        await checkTTS();
        return { available: true, activeModel: activeTextModel, ttsAvailable };
    } catch (e: any) {
        const primaryError = `Health check failed for primary model (${PRIMARY_TEXT_GENERATION_MODEL}). Error: ${e.message}. Trying fallback.`;
        console.warn(primaryError);
        log('Failure', PRIMARY_TEXT_GENERATION_MODEL, e.message);
        
        try {
            await ai.models.generateContent({ model: FALLBACK_TEXT_GENERATION_MODEL, contents: [{ role: 'user', parts: [{ text: 'healthcheck' }] }] });
            activeTextModel = FALLBACK_TEXT_GENERATION_MODEL;
            const statusMessage = `Health check PASSED with fallback. Active model: ${activeTextModel}`;
            console.log(statusMessage);
            log('Success (Fallback)', FALLBACK_TEXT_GENERATION_MODEL, undefined);
            await checkTTS();
            return { available: true, activeModel: activeTextModel, ttsAvailable };
        } catch (e2: any) {
            const fallbackError = `Health check failed for fallback model (${FALLBACK_TEXT_GENERATION_MODEL}). Service unavailable. Error: ${e2.message}`;
            console.error(fallbackError);
            log('Failure', FALLBACK_TEXT_GENERATION_MODEL, e2.message);
            
            const isQuota = e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED') || 
                            e2.message?.includes('429') || e2.message?.includes('RESOURCE_EXHAUSTED');

            return { available: false, activeModel: '', ttsAvailable: false, error: "Both primary and fallback AI models are unavailable.", isQuotaError: isQuota };
        }
    }
};

export const generateCardFront = async (
    deck: ThemedDeck | CustomThemeData,
    groupSetting: SocialContext,
    numParticipants: number,
    participantNames: string[],
    activeParticipantName: string | null,
    ageFilters: AgeFilters,
    voiceName: VoiceName,
    languageCode: LanguageCode,
    historyLength: number,
    addLogEntry: (entry: DevLogEntry) => void,
    shouldGenerateAudio: boolean,
    options: { disliked: boolean } = { disliked: false }
): Promise<{
    text: string;
    ttsInput: string | null;
    ttsVoice: VoiceName | null;
    reflectionText?: string;
    timerDuration?: number;
    requestTimestamp: number;
    responseTimestamp: number;
    inputPrompt: string;
    rawLlmOutput: string;
    error?: string;
}> => {
    if (!ai) return { text: "", ttsInput: null, ttsVoice: null, requestTimestamp: Date.now(), responseTimestamp: Date.now(), inputPrompt: "", rawLlmOutput: "", error: "AI not initialized" };

    const requestTimestamp = Date.now();
    const sessionId = deck.id;
    let chat = chatSessions[sessionId];
    lastActiveSessionId = sessionId;

    // Construct System Instruction
    const contextDesc = `Social Context: ${groupSetting}. Participants: ${numParticipants} (${participantNames.join(', ')}). Active Player: ${activeParticipantName || 'Unknown'}.`;
    const deckDesc = `Deck: ${deck.name}. Description: ${deck.description}. Intensity: ${(deck.intensity || []).join(', ')}.`;
    
    const systemInstruction = `You are Resonance, an AI facilitator for deep human connection. 
    ${deckDesc}
    ${contextDesc}
    Generate a single card prompt. It should be insightful, engaging, and fit the deck theme.
    
    Return a JSON object with the following schema:
    {
        "text": "The main prompt text to be displayed on the card.",
        "ttsInput": "Optional. A version of the text optimized for speech synthesis (e.g. phonetic spellings or conversational tweaks). If null, 'text' will be used.",
        "ttsVoice": "Optional. Recommended voice name.",
        "reflectionText": "Optional. A follow-up question or reflection prompt if the card is an activity or timed exercise.",
        "timerDuration": "Optional. Duration in seconds if the card is a timed activity."
    }
    `;

    if (!chat) {
        chat = ai.chats.create({
            model: activeTextModel,
            config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        text: { type: Type.STRING },
                        ttsInput: { type: Type.STRING },
                        ttsVoice: { type: Type.STRING },
                        reflectionText: { type: Type.STRING },
                        timerDuration: { type: Type.INTEGER }
                    },
                    required: ["text"]
                }
            }
        });
        chatSessions[sessionId] = chat;
    }

    const prompt = options.disliked ? "The previous card was disliked. Generate a different kind of prompt from this deck." : "Draw a card.";

    try {
        const result = await chat.sendMessage({ message: prompt });
        const responseTimestamp = Date.now();
        const jsonText = result.text;
        
        let parsed: any = {};
        try {
            parsed = JSON.parse(jsonText);
        } catch (e) {
             console.error("JSON parse error", e);
             parsed = { text: jsonText };
        }

        return {
            text: parsed.text,
            ttsInput: parsed.ttsInput || null,
            ttsVoice: parsed.ttsVoice || null,
            reflectionText: parsed.reflectionText,
            timerDuration: parsed.timerDuration,
            requestTimestamp,
            responseTimestamp,
            inputPrompt: prompt,
            rawLlmOutput: jsonText
        };

    } catch (e: any) {
        return {
            text: "",
            ttsInput: null,
            ttsVoice: null,
            requestTimestamp,
            responseTimestamp: Date.now(),
            inputPrompt: prompt,
            rawLlmOutput: "",
            error: e.message
        };
    }
}

export const generateCardBack = async (
    cardText: string,
    deck: ThemedDeck | CustomThemeData,
    parentCardText?: string
): Promise<{
    cardBackNotesText: string | null;
    requestTimestamp: number;
    responseTimestamp: number;
    inputPrompt: string;
    rawLlmOutput: string;
    error?: string;
}> => {
     if (!ai) return { cardBackNotesText: null, requestTimestamp: Date.now(), responseTimestamp: Date.now(), inputPrompt: "", rawLlmOutput: "", error: "AI not initialized" };
     
     const prompt = `Generate guidance for this card prompt: "${cardText}" from deck "${deck.name}". Include "The Idea", "Getting Started", and "Deeper Dive".`;
     const requestTimestamp = Date.now();
     
     try {
         const response = await ai.models.generateContent({
             model: activeTextModel,
             contents: prompt
         });
         return {
             cardBackNotesText: response.text,
             requestTimestamp,
             responseTimestamp: Date.now(),
             inputPrompt: prompt,
             rawLlmOutput: response.text
         };
     } catch (e: any) {
         return { cardBackNotesText: null, requestTimestamp, responseTimestamp: Date.now(), inputPrompt: prompt, rawLlmOutput: "", error: e.message };
     }
}

export const generateAudioForText = async (
    text: string,
    voiceName: VoiceName,
    styleDirective: string | null
): Promise<{
    audioData: string | null;
    audioMimeType: string | null;
    requestTimestamp: number;
    responseTimestamp: number;
    logData: any;
    error?: string;
}> => {
    if (!ai) return { audioData: null, audioMimeType: null, requestTimestamp: Date.now(), responseTimestamp: Date.now(), logData: {}, error: "AI not initialized" };
    
    const requestTimestamp = Date.now();
    try {
        const response = await ai.models.generateContent({
            model: TTS_MODEL,
            contents: {
                parts: [{ text: styleDirective ? `${styleDirective} ${text}` : text }]
            },
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName }
                    }
                }
            }
        });
        
        const audioPart = response.candidates?.[0]?.content?.parts?.[0];
        if (audioPart?.inlineData) {
            return {
                audioData: audioPart.inlineData.data,
                audioMimeType: audioPart.inlineData.mimeType,
                requestTimestamp,
                responseTimestamp: Date.now(),
                logData: { text, voiceName }
            };
        }
        return { audioData: null, audioMimeType: null, requestTimestamp, responseTimestamp: Date.now(), logData: { text }, error: "No audio data" };

    } catch (e: any) {
         return { audioData: null, audioMimeType: null, requestTimestamp, responseTimestamp: Date.now(), logData: { text }, error: e.message };
    }
}

export const sendFeedbackToChat = async (
    text: string,
    feedbackType: 'liked' | 'disliked',
    addLogEntry: (entry: DevLogEntry) => void
) => {
    // If we have an active session, we could send feedback to it.
    // Since App.tsx calls this without session context, we try to use the last active one or just log.
    if (lastActiveSessionId && chatSessions[lastActiveSessionId]) {
        try {
            const chat = chatSessions[lastActiveSessionId];
            await chat.sendMessage({ message: `User feedback: The user ${feedbackType} the prompt "${text}".` });
            addLogEntry({
                type: 'user-feedback',
                requestTimestamp: Date.now(),
                responseTimestamp: Date.now(),
                data: { input: text, output: feedbackType }
            });
        } catch (e) {
            console.warn("Failed to send feedback to chat session", e);
        }
    } else {
        console.log(`Feedback (No Session): ${feedbackType} for "${text}"`);
    }
}

// --- BACKUP CARDS (OFFLINE MODE) ---

const BACKUP_CARDS = [
    { text: "What is a small, simple thing that brought you a sense of ease or joy today?", category: "INTRODUCTIONS" },
    { text: "If you could send a message to your younger self, what would you say?", category: "IMAGE_OF_SELF" },
    { text: "What is a belief you hold that has changed significantly in the last few years?", category: "IMAGE_OF_SELF" },
    { text: "Describe a moment when you felt truly seen by someone.", category: "INTIMACY_CONNECTION" },
    { text: "What is something you are currently avoiding?", category: "EDGY_CONFRONTATIONS" },
    { text: "If fear was not a factor, what is one thing you would do differently right now?", category: "EDGY_CONFRONTATIONS" },
    { text: "What does 'home' feel like to you?", category: "INTRODUCTIONS" },
    { text: "Share a memory that you haven't thought about in a long time.", category: "RELATIONAL" },
    { text: "What is a quality in others that you admire most?", category: "RELATIONAL" },
    { text: "Close your eyes for 30 seconds. What do you hear?", category: "IMAGE_OF_SELF", isTimed: true, timerDuration: 30 },
    { text: "What is a dream you've let go of, and why?", category: "IMAGE_OF_SELF" },
    { text: "When was the last time you felt a sense of awe?", category: "EXTERNAL_VIEWS" },
    { text: "What is one thing you are grateful for in your life right now?", category: "INTRODUCTIONS" },
    { text: "Who has had the biggest positive influence on your life?", category: "RELATIONAL" },
    { text: "If you could have dinner with anyone, living or dead, who would it be and why?", category: "IMAGINATIVE" },
    { text: "What is a habit you would like to break?", category: "IMAGE_OF_SELF" },
    { text: "What is a skill you would love to learn?", category: "IMAGE_OF_SELF" },
    { text: "Describe your perfect day.", category: "IMAGINATIVE" },
    { text: "What is something that always makes you laugh?", category: "INTRODUCTIONS" },
    { text: "If you were a character in a book, how would the author describe you?", category: "IMAGINATIVE" }
];

// Track used indices to avoid repetition until exhausted
let usedBackupIndices = new Set<number>();

export const drawOfflineCard = (): DrawnCardData => {
    // Determine available indices
    const availableIndices = BACKUP_CARDS.map((_, i) => i).filter(i => !usedBackupIndices.has(i));
    
    // Reset if all used
    if (availableIndices.length === 0) {
        usedBackupIndices.clear();
        BACKUP_CARDS.forEach((_, i) => availableIndices.push(i));
    }

    // Pick random from available
    const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    usedBackupIndices.add(randomIndex);
    
    const randomCard = BACKUP_CARDS[randomIndex];
    const id = `offline-card-${Date.now()}`;
    return {
        id,
        themedDeckId: 'OFFLINE', 
        feedback: null,
        timestamp: Date.now(),
        text: randomCard.text,
        ttsInput: null,
        ttsVoice: null,
        audioData: null,
        audioMimeType: null,
        cardBackNotesText: "**Offline Mode:** This card was drawn from the local backup because the AI service is currently unavailable. Enjoy the conversation!",
        isTimed: (randomCard as any).isTimed || false,
        hasFollowUp: false,
        timerDuration: (randomCard as any).timerDuration || null,
        followUpPromptText: null,
        followUpAudioData: null,
        followUpAudioMimeType: null,
        isCompletedActivity: false,
        isFollowUp: false,
        activeFollowUpCard: null,
        isFaded: false
    };
};

export const OFFLINE_DECK: ThemedDeck = {
    id: 'OFFLINE', 
    name: 'Offline Essentials', 
    category: 'SPECIALS',
    description: "A curated collection of prompts available when the connection to the stars is temporarily clouded.",
    intensity: [1, 2, 3],
    themes: ['Light & Essence', 'Mind & Thoughts'],
    cardTypes: ['Question'],
    ageGroups: ['Adults', 'Teens', 'Kids'],
    // Updated to match look and feel of other decks (Gradient instead of dashed border)
    visualStyle: 'bg-gradient-to-br from-slate-600 via-slate-700 to-slate-800' 
};


// --- TYPES ---

export type SocialContext = "SOLO" | "GENERAL" | "STRANGERS" | "FRIENDS" | "ROMANTIC" | "FAMILY" | "TEAM";
export type AgeGroup = 'Adults' | 'Teens' | 'Kids';

export interface AgeFilters {
    adults: boolean;
    teens: boolean;
    kids: boolean;
}

export type CoreTheme = 
  | 'Body & Sensation' | 'Mind & Thoughts' | 'Heart & Emotions' | 'Shadow & Depth'
  | 'Light & Essence' | 'Desire & Intimacy' | 'Parts & Voices' | 'Outer World'
  | 'Past & Memory' | 'Vision & Future' | 'Play & Creativity' | 'Spirit & Awe'
  | 'Transcendence & Mystery';

export const ALL_CORE_THEMES: CoreTheme[] = [
  'Body & Sensation', 'Mind & Thoughts', 'Heart & Emotions', 'Shadow & Depth',
  'Light & Essence', 'Desire & Intimacy', 'Parts & Voices', 'Outer World',
  'Past & Memory', 'Vision & Future', 'Play & Creativity', 'Spirit & Awe',
  'Transcendence & Mystery'
];

export const THEME_DEFINITIONS: Record<CoreTheme, string> = {
    'Body & Sensation': "Focus on somatic awareness, felt sense, and physical presence. Ask users to notice tension, breath, and gut feelings.",
    'Mind & Thoughts': "Explore beliefs, logic, cognitive patterns, and intellectual curiosities. Challenge assumptions.",
    'Heart & Emotions': "Dive into the landscape of feelings, vulnerability, emotional intelligence, and empathy.",
    'Shadow & Depth': "Explore the unsaid, the hidden, the repressed, and the uncomfortable with compassion. Do not shy away from darkness.",
    'Light & Essence': "Focus on joy, core values, gratitude, and the sparks that make life feel meaningful.",
    'Desire & Intimacy': "Explore wants, needs, eroticism, connection, and the vulnerability of asking for what one craves.",
    'Parts & Voices': "Invoke Internal Family Systems (IFS). Speak to the inner critic, inner child, protectors, and managers.",
    'Outer World': "Discuss society, culture, environment, and one's role within the larger collective systems.",
    'Past & Memory': "Explore personal history, childhood, ancestry, and the stories that have shaped the current self.",
    'Vision & Future': "Focus on aspirations, legacy, goals, and the potential versions of the self that are emerging.",
    'Play & Creativity': "Encourage imagination, flow, humor, and non-linear thinking. Be whimsical.",
    'Spirit & Awe': "Touch on the sacred, the divine, wonder, and moments of reverence or spiritual connection.",
    'Transcendence & Mystery': "Explore the unknown, the metaphysical, ego-death, and experiences beyond the self."
};

export type IntensityLevel = 1 | 2 | 3 | 4 | 5;
export const ALL_INTENSITY_LEVELS: IntensityLevel[] = [1, 2, 3, 4, 5];

export const INTENSITY_DESCRIPTIONS: Record<IntensityLevel, { label: string; emoji: string; tooltip: string }> = {
    1: { label: '1', emoji: '🌱', tooltip: 'Surface: Light, safe, icebreakers.' },
    2: { label: '2', emoji: '💬', tooltip: 'Connecting: Invites personal stories and opinions with gentle vulnerability.' },
    3: { label: '3', emoji: '❤️', tooltip: 'Vulnerable: Asks for feelings, needs, and deeper self-revelation.' },
    4: { label: '4', emoji: '🔥', tooltip: 'Edgy: Touches on shadow, withheld truths, and charged topics.' },
    5: { label: '5', emoji: '💎', tooltip: 'Exposing: Deep, direct, and unfiltered for radical honesty.' },
};

export type CardType = 
  | 'Question' | 'Directive' | 'Reflection' | 'Practice' | 'Wildcard' | 'Connector';

export const ALL_CARD_TYPES: CardType[] = [
    'Question', 'Directive', 'Reflection', 'Practice', 'Wildcard', 'Connector'
];

export const CARD_TYPE_DEFINITIONS: Record<CardType, string> = {
    'Question': "An open-ended inquiry designed to provoke thought or story. Standard format.",
    'Directive': "An instruction to do something right now (e.g., 'Close your eyes and...', 'Tell the person to your left...').",
    'Reflection': "A prompt for internal contemplation, often used for solo journaling or quiet pondering.",
    'Practice': "A somatic or interactive exercise. Often timed. Involves active participation beyond just speaking.",
    'Wildcard': "Unexpected, playful, or radical shifts in the conversation. Can be meta-commentary or a game.",
    'Connector': "Specifically designed to build a bridge between two people. Often asks for shared reality or mutual appreciation."
};

export interface DeckCategory {
  id: string;
  name: string;
  description?: string;
}

export interface ThemedDeck {
  id: string;
  name:string;
  category: DeckCategory['id'];
  description: string;
  intensity: IntensityLevel[];
  themes: CoreTheme[];
  cardTypes: CardType[];
  socialContexts?: SocialContext[]; 
  ageGroups: AgeGroup[];
  visualStyle?: string;
}

// --- DATA DEFINITIONS ---

export const DECK_CATEGORIES: DeckCategory[] = [
    { id: 'SPECIALS', name: 'Specials' },
    { id: 'INTRODUCTIONS', name: 'Introductions' },
    { id: 'IMAGE_OF_SELF', name: 'Image of Self' },
    { id: 'INTIMACY_CONNECTION', name: 'Intimacy & Connection' },
    { id: 'EXTERNAL_VIEWS', name: 'External Views' },
    { id: 'RELATIONAL', name: 'Relational' },
    { id: 'IMAGINATIVE', name: 'Imaginative' },
    { id: 'EDGY_CONFRONTATIONS', name: 'Edgy Confrontations' },
];

export const WOAH_DUDE_DECK: ThemedDeck = {
    id: 'WOAH_DUDE', name: 'Woah Dude!', category: 'SPECIALS',
    description: "Expand your consciousness and question reality. For deep dives into the fabric of the mind.",
    intensity: [3, 4],
    themes: ['Transcendence & Mystery', 'Spirit & Awe', 'Mind & Thoughts', 'Play & Creativity'],
    cardTypes: ['Question', 'Directive', 'Reflection', 'Wildcard'],
    ageGroups: ['Adults'],
    visualStyle: 'psychedelic-bg'
};

export const ALL_THEMED_DECKS: ThemedDeck[] = [
    { id: 'GENTLE_CURRENTS', name: 'Gentle Currents', category: 'INTRODUCTIONS', description: "Dipping a toe in the water. Light, safe, and connecting prompts to start any conversation with ease.", intensity: [1, 2], themes: ['Body & Sensation', 'Mind & Thoughts', 'Heart & Emotions', 'Light & Essence', 'Outer World', 'Past & Memory', 'Play & Creativity'], cardTypes: ['Question', 'Reflection'], ageGroups: ['Adults', 'Teens', 'Kids'], },
    { id: 'THE_ICEBREAKER', name: 'The Icebreaker', category: 'INTRODUCTIONS', description: "Fun, low-pressure prompts to build energy and instant rapport.", intensity: [1], themes: ['Play & Creativity', 'Outer World'], cardTypes: ['Wildcard', 'Directive', 'Question'], ageGroups: ['Adults', 'Teens', 'Kids'], socialContexts: ['GENERAL', 'STRANGERS', 'TEAM'], },
    { id: 'LEGACY_VISION', name: 'Legacy & Vision', category: 'IMAGE_OF_SELF', description: "What are you building? Who are you becoming? Explore your goals, your impact, and the future you are creating.", intensity: [2, 3, 4], themes: ['Vision & Future', 'Light & Essence'], cardTypes: ['Question', 'Reflection'], ageGroups: ['Adults', 'Teens'], },
    { id: 'ROOTS_BRANCHES', name: 'Roots & Branches', category: 'IMAGE_OF_SELF', description: "Explore your personal history, family stories, and the memories that shaped you.", intensity: [2, 3, 4], themes: ['Past & Memory', 'Heart & Emotions'], cardTypes: ['Question', 'Reflection'], ageGroups: ['Adults', 'Teens'], },
    { id: 'INNER_CRITIC_SAGE', name: 'The Inner Critic & The Sage', category: 'IMAGE_OF_SELF', description: "Meet the voices within. Learn to distinguish your inner critic from your inner wisdom.", intensity: [2, 3, 4], themes: ['Parts & Voices', 'Mind & Thoughts'], cardTypes: ['Question', 'Practice'], ageGroups: ['Adults', 'Teens'], },
    { id: 'SOMATIC_SANCTUARY', name: 'Somatic Sanctuary', category: 'IMAGE_OF_SELF', description: "Your body is speaking. This deck is a quiet space to listen to its language of sensation and feeling.", intensity: [2, 3], themes: ['Body & Sensation', 'Heart & Emotions'], cardTypes: ['Directive', 'Practice', 'Question'], ageGroups: ['Adults', 'Teens', 'Kids'], },
    { id: 'EROS_ESSENCE', name: 'Eros & Essence', category: 'INTIMACY_CONNECTION', description: "Explore the landscape of desire, turn-on, and mindful intimacy, connecting sexuality to your core self.", intensity: [3, 4, 5], themes: ['Desire & Intimacy', 'Light & Essence'], cardTypes: ['Question', 'Directive', 'Reflection'], ageGroups: ['Adults'], },
    { id: 'DEEPENING_PARTNERSHIP', name: 'Deepening Partnership', category: 'INTIMACY_CONNECTION', description: "For established couples. Reconnect, navigate challenges, and build your shared future.", intensity: [2, 3, 4], themes: ['Heart & Emotions', 'Vision & Future', 'Shadow & Depth'], cardTypes: ['Question', 'Practice', 'Connector'], ageGroups: ['Adults'], socialContexts: ['ROMANTIC'], },
    { id: 'PLATONIC_INTIMACY', name: 'Platonic Intimacy', category: 'INTIMACY_CONNECTION', description: "For deep friendships. Explore the landscape of connection, care, and vulnerability that exists outside of romance.", intensity: [2, 3, 4], themes: ['Heart & Emotions', 'Light & Essence'], cardTypes: ['Question', 'Reflection'], ageGroups: ['Adults', 'Teens'], socialContexts: ['FRIENDS'], },
    { id: 'ATTRACTION_MAP', name: 'Attraction Map', category: 'INTIMACY_CONNECTION', description: "What truly captivates you? A solo or shared journey to map the full spectrum of your attractions—physical, emotional, intellectual, and spiritual.", intensity: [3, 4], themes: ['Desire & Intimacy', 'Mind & Thoughts', 'Spirit & Awe'], cardTypes: ['Question', 'Reflection'], ageGroups: ['Adults'], socialContexts: ['SOLO', 'ROMANTIC'], },
    { id: 'COURAGEOUS_REQUESTS', name: 'Courageous Requests', category: 'INTIMACY_CONNECTION', description: "Asking for what you want is a practice. A deck of sentence stems and prompts to help you voice your desires and needs clearly and kindly.", intensity: [3, 4], themes: ['Desire & Intimacy', 'Heart & Emotions'], cardTypes: ['Reflection', 'Practice'], ageGroups: ['Adults'], },
    { id: 'AWE_WONDER', name: 'Awe & Wonder', category: 'EXTERNAL_VIEWS', description: "Reconnect with mystery, meaning, and the sacred in everyday life. A journey into spirit and reverence.", intensity: [2, 3], themes: ['Spirit & Awe', 'Transcendence & Mystery'], cardTypes: ['Reflection', 'Question'], ageGroups: ['Adults', 'Teens'], visualStyle: 'celestial-bg', },
    { id: 'SOCIAL_MIRROR', name: 'Social Mirror', category: 'EXTERNAL_VIEWS', description: "Explore your relationship with culture, community, and the world around you.", intensity: [2, 3], themes: ['Outer World', 'Mind & Thoughts'], cardTypes: ['Question', 'Reflection'], ageGroups: ['Adults', 'Teens'], },
    { id: 'THE_ORACLE', name: 'The Oracle', category: 'EXTERNAL_VIEWS', description: "Wisdom through the ages. Reflect on quotes, poems, and koans to see what timeless truth speaks to you now.", intensity: [2, 3], themes: ['Spirit & Awe', 'Mind & Thoughts', 'Light & Essence'], cardTypes: ['Reflection'], ageGroups: ['Adults', 'Teens'], },
    { id: 'THE_CHECK_IN', name: 'The Check-in', category: 'RELATIONAL', description: "A quick ritual for teams or partners to touch base, clear the air, and connect on what's real.", intensity: [2], themes: ['Mind & Thoughts', 'Heart & Emotions'], cardTypes: ['Reflection', 'Question'], ageGroups: ['Adults', 'Teens'], socialContexts: ['FRIENDS', 'ROMANTIC', 'FAMILY', 'TEAM'], },
    { id: 'FIRST_IMPRESSIONS', name: 'First Impressions', category: 'RELATIONAL', description: "Go beyond surface-level facts. A deck to explore the perceptions, stories, and assumptions we form when we first meet.", intensity: [1, 2], themes: ['Play & Creativity', 'Mind & Thoughts', 'Light & Essence'], cardTypes: ['Question', 'Wildcard'], ageGroups: ['Adults', 'Teens'], socialContexts: ['STRANGERS', 'ROMANTIC'], },
    { id: 'FRIENDS_CIRCLE', name: "Friends' Circle", category: 'RELATIONAL', description: "The conversation you've been meaning to have. Go beyond the daily updates and strengthen your bond.", intensity: [2, 3], themes: ['Heart & Emotions', 'Past & Memory', 'Light & Essence', 'Vision & Future'], cardTypes: ['Question', 'Reflection', 'Connector'], ageGroups: ['Adults', 'Teens'], socialContexts: ['FRIENDS'], },
    { id: 'FAMILY_HEARTH', name: 'Family Hearth', category: 'RELATIONAL', description: "Share stories, appreciate one another, and bridge generations. A safe space for family connection.", intensity: [1, 2, 3], themes: ['Heart & Emotions', 'Past & Memory', 'Light & Essence'], cardTypes: ['Question', 'Reflection'], ageGroups: ['Adults', 'Teens', 'Kids'], socialContexts: ['FAMILY'], },
    { id: 'TEAM_KICK_OFF', name: 'Team Kick-off', category: 'RELATIONAL', description: "Start a project or a new team on a foundation of trust and clarity. Align on goals and working styles.", intensity: [1, 2], themes: ['Vision & Future', 'Light & Essence', 'Mind & Thoughts'], cardTypes: ['Question', 'Practice'], ageGroups: ['Adults', 'Teens'], socialContexts: ['TEAM'], },
    { id: 'PARENTING_PARTNERS', name: 'Parenting Partners', category: 'RELATIONAL', description: "Navigate the journey of parenthood together. A space to share the joys, challenges, and your vision for your family.", intensity: [2, 3, 4], themes: ['Heart & Emotions', 'Shadow & Depth', 'Vision & Future'], cardTypes: ['Question', 'Practice'], ageGroups: ['Adults'], socialContexts: ['ROMANTIC'], },
    { id: 'KIDS_TABLE', name: "Kid's Table", category: 'RELATIONAL', description: "Spark imagination and encourage big feelings. Fun questions and activities for young minds and hearts.", intensity: [1, 2], themes: ['Play & Creativity', 'Heart & Emotions', 'Mind & Thoughts'], cardTypes: ['Question', 'Directive'], ageGroups: ['Kids'], },
    { id: 'TEEN_CAMPFIRE', name: 'Teen Campfire', category: 'RELATIONAL', description: "Real talk for real life. Explore identity, friendships, and the future in a space that gets it.", intensity: [2, 3], themes: ['Mind & Thoughts', 'Light & Essence', 'Outer World', 'Heart & Emotions'], cardTypes: ['Question', 'Reflection'], ageGroups: ['Teens'], },
    { id: 'THE_WRITERS_ROOM', name: "The Writer's Room", category: 'IMAGINATIVE', description: "A deck of creative kindling. Sentence stems and fill-in-the-blanks to bypass the blank page and start writing.", intensity: [2, 3], themes: ['Play & Creativity', 'Mind & Thoughts', 'Past & Memory'], cardTypes: ['Reflection'], ageGroups: ['Adults', 'Teens'], socialContexts: ['SOLO'], },
    { id: 'THE_DILEMMA_ENGINE', name: 'The Dilemma Engine', category: 'IMAGINATIVE', description: "Choose your path. A series of intriguing dilemmas that reveal values, priorities, and hidden beliefs.", intensity: [2, 3], themes: ['Mind & Thoughts', 'Light & Essence', 'Outer World'], cardTypes: ['Question'], ageGroups: ['Adults', 'Teens'], },
    { id: 'THE_DREAM_FACTORY', name: 'The Dream Factory', category: 'IMAGINATIVE', description: "A launchpad for imagination. Prompts to generate ideas, play with possibilities, and create something new.", intensity: [2, 3], themes: ['Play & Creativity', 'Vision & Future'], cardTypes: ['Directive', 'Wildcard'], ageGroups: ['Adults', 'Teens', 'Kids'], },
    { id: 'PATTERN_INTERRUPT', name: 'Pattern Interrupt', category: 'IMAGINATIVE', description: "Feeling stuck or too heavy? Draw from this deck to shift the energy with a jolt of playfulness or a fresh perspective.", intensity: [1, 2], themes: ['Play & Creativity', 'Mind & Thoughts', 'CardTypes', 'Wildcard', 'Question'], cardTypes: ['Wildcard', 'Question'], ageGroups: ['Adults', 'Teens', 'Kids'], },
    { id: 'THE_SHADOW_CABINET', name: 'The Shadow Cabinet', category: 'EDGY_CONFRONTATIONS', description: "What we hide holds power. A courageous exploration of triggers, shame, and the unowned parts of yourself.", intensity: [3, 4], themes: ['Shadow & Depth', 'Parts & Voices'], cardTypes: ['Question', 'Reflection'], ageGroups: ['Adults', 'Teens'], visualStyle: 'noir-bg', },
    { id: 'ON_THE_EDGE', name: 'On The Edge', category: 'EDGY_CONFRONTATIONS', description: "For conversations that matter. Explore charged topics, withheld truths, and challenging perspectives with intention.", intensity: [4], themes: ['Shadow & Depth', 'Desire & Intimacy', 'Heart & Emotions'], cardTypes: ['Question', 'Directive'], ageGroups: ['Adults'], },
    { id: 'NO_MASKS', name: 'No Masks', category: 'EDGY_CONFRONTATIONS', description: "A space for radical honesty and unfiltered expression. For those ready to meet the depths without reservation.", intensity: [5], themes: ['Shadow & Depth', 'Desire & Intimacy', 'Heart & Emotions', 'Light & Essence', 'Transcendence & Mystery'], cardTypes: ['Question', 'Directive'], ageGroups: ['Adults'], },
];

export const DECK_CATEGORY_COLORS: Record<string, string> = {
    'SPECIALS': "from-fuchsia-500 via-purple-600 to-pink-700 hover:from-fuchsia-400 hover:to-pink-600",
    'INTRODUCTIONS': "from-sky-600 to-cyan-700 hover:from-sky-500 hover:to-cyan-600",
    'IMAGE_OF_SELF': "from-emerald-600 to-green-700 hover:from-emerald-500 hover:to-green-600",
    'INTIMACY_CONNECTION': "from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600",
    'EXTERNAL_VIEWS': "from-purple-600 to-pink-700 hover:from-purple-500 hover:to-pink-600",
    'RELATIONAL': "from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500",
    'IMAGINATIVE': "from-teal-500 to-cyan-600 hover:from-teal-400 hover:to-cyan-500",
    'EDGY_CONFRONTATIONS': "from-indigo-700 to-slate-800 hover:from-indigo-600 hover:to-slate-700",
};

export const CUSTOM_DECK_COLOR_PALETTE = [
    "from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600",
    "from-cyan-600 to-sky-700 hover:from-cyan-500 hover:to-sky-600",
    "from-teal-600 to-emerald-700 hover:from-teal-500 hover:to-emerald-600",
    "from-fuchsia-600 to-purple-700 hover:from-fuchsia-500 hover:to-purple-700",
    "from-lime-600 to-green-700 hover:from-lime-500 hover:to-green-600",
    "from-amber-600 to-orange-700 hover:from-amber-500 hover:to-orange-600",
];

export type CustomThemeId = `CUSTOM_${string}`;

export interface CustomThemeData {
  id: CustomThemeId;
  name: string;
  description: string;
  colorClass: string;
  themes?: CoreTheme[];
  cardTypes?: CardType[];
  intensity?: IntensityLevel[];
}

export type ThemeIdentifier = ThemedDeck['id'] | CustomThemeId;

export interface DrawnCardData { 
  id: string;
  themedDeckId: ThemeIdentifier; 
  feedback: 'liked' | 'disliked' | null;
  timestamp: number;
  drawnForParticipantId?: string | null;
  drawnForParticipantName?: string | null;
  isFaded?: boolean; 
  text: string;
  ttsInput: string | null;
  ttsVoice: VoiceName | null;
  audioData: string | null;
  audioMimeType: string | null;
  cardBackNotesText: string | null;
  isTimed?: boolean;
  hasFollowUp: boolean;
  timerDuration?: number | null;
  followUpPromptText?: string | null;
  followUpAudioData?: string | null;
  followUpAudioMimeType?: string | null;
  isCompletedActivity?: boolean;
  isFollowUp?: boolean;
  activeFollowUpCard?: DrawnCardData | null;
}

export type VoiceName = "Sulafat" | "Puck" | "Vindemiatrix" | "Enceladus" | "Zubenelgenubi" | "Fenrir";
export type LanguageCode = string;

export interface VoicePersona {
  id: string;
  name: string;
  gender: 'Female' | 'Male' | 'Neutral';
  voiceName: VoiceName;
  description: string;
  keywords: string;
  voiceAccentHint: string;
}

export const CURATED_VOICE_PERSONAS: VoicePersona[] = [
  { id: "voice_shohreh", name: "The Oracle (Shohreh)", gender: "Female", voiceName: "Vindemiatrix", description: "A deep, resonant voice that carries a sense of wisdom and authority.", keywords: "deep, resonant, wise, authoritative, gravelly", voiceAccentHint: "a deep, resonant, hypnotic Persian rhythm, commanding yet motherly tone reminiscent of Shohreh Aghdashloo" },
  { id: "voice_michelle", name: "The Mentor (Michelle)", gender: "Female", voiceName: "Sulafat", description: "A calm, elegant voice with a warm, clear, and reassuring delivery.", keywords: "elegant, calm, clear, warm, reassuring", voiceAccentHint: "a calm, smooth, gentle, and clear tone, elegant but never stiff, subtle Malaysian lilt, reminiscent of Michelle Yeoh" },
  { id: "voice_rihanna", name: "The Muse (Rihanna)", gender: "Female", voiceName: "Fenrir", description: "A cool, smooth voice with a confident, playful, and musical lilt.", keywords: "cool, smooth, playful, musical, confident", voiceAccentHint: "a cool, smooth, and playful tone with a husky-bright swing, raw Bajan real warmth, musical and island lilt reminiscent of Rihanna" },
  { id: "voice_diego", name: "The Thinker (Diego)", gender: "Male", voiceName: "Enceladus", description: "A warm, thoughtful voice with a gentle, musing cadence that feels both intelligent and sincere.", keywords: "warm, thoughtful, steady, sincere, gentle, musing", voiceAccentHint: "a warm, thoughtful, husky and steady tone with a mellow Mexican cadence, and rounded authentic and unpolished edge, reminiscent of Diego Luna" },
  { id: "voice_trevor", name: "The Companion (Trevor)", gender: "Male", voiceName: "Zubenelgenubi", description: "An upbeat, warm voice with a clear, charismatic, and friendly intonation.", keywords: "upbeat, warm, engaging, charismatic, clear, friendly", voiceAccentHint: "a warm lilt, smooth with subtle playful pitch swings, yet with South African earthy edge, reminiscent of Trevor Noah" },
  { id: "voice_riz", name: "The Catalyst (Riz)", gender: "Male", voiceName: "Puck", description: "A clear, rhythmic voice that feels energetic, witty, and engaging, perfect for sparking new ideas.", keywords: "rhythmic, clear, witty, engaging, articulate, energetic", voiceAccentHint: "Slight rasp, calm staccato consonants, British-Asian, sometimes East London, inflections, earthy, alive and witty tone reminiscent of Riz Ahmed" },
];

export const DEFAULT_VOICE_NAME: VoiceName = "Enceladus";
export const DEFAULT_LANGUAGE_CODE: LanguageCode = "en-US";

export interface GroupSettingOption { id: SocialContext; label: string; description: string; }

export const GROUP_SETTINGS: GroupSettingOption[] = [
  { id: "SOLO", label: "Solo", description: "For introspection, journaling, or individual reflection." },
  { id: "GENERAL", label: "General", description: "For any group or when unsure." },
  { id: "STRANGERS", label: "Strangers", description: "Getting to know each other, icebreakers." },
  { id: "FRIENDS", label: "Friends", description: "Deeper connection, shared experiences." },
  { id: "ROMANTIC", label: "Romantic", description: "Intimacy, partnership, shared journey." },
  { id: "FAMILY", label: "Family", description: "Bonds, history, understanding." },
  { id: "TEAM", label: "Team", description: "Team dynamics, collaboration, professional connection." },
];
export const DEFAULT_GROUP_SETTING: SocialContext = "GENERAL";

// --- HELPERS ---

export const getVisibleDecks = (groupSetting: SocialContext, ageFilters: AgeFilters, intensityFilters: IntensityLevel[], forceShowAll: boolean = false): ThemedDeck[] => {
    if (forceShowAll) return ALL_THEMED_DECKS;
    return ALL_THEMED_DECKS.filter(deck => {
        if (deck.category === 'SPECIALS') return false;
        const activeAgeGroups: AgeGroup[] = [];
        if (ageFilters.adults) activeAgeGroups.push('Adults');
        if (ageFilters.teens) activeAgeGroups.push('Teens');
        if (ageFilters.kids) activeAgeGroups.push('Kids');
        const isAgeMatch = deck.ageGroups.some(ag => activeAgeGroups.includes(ag));
        if (!isAgeMatch) return false;
        if (ageFilters.teens || ageFilters.kids) {
            if (deck.intensity.some(level => level >= 4)) return false;
        }
        if (intensityFilters.length > 0 && !deck.intensity.some(level => intensityFilters.includes(level))) {
            return false;
        }
        if (deck.socialContexts && !deck.socialContexts.includes(groupSetting)) {
            return false;
        }
        return true;
    });
};

export const getThemedDeckById = (deckId: ThemedDeck['id']): ThemedDeck | null => {
  if (deckId === 'WOAH_DUDE') return WOAH_DUDE_DECK;
  if (deckId === 'OFFLINE') return OFFLINE_DECK;
  return ALL_THEMED_DECKS.find(d => d.id === deckId) || null;
}
export const getCustomDeckById = (customDeckId: CustomThemeId, customDecks: CustomThemeData[]): CustomThemeData | null => {
  return customDecks.find(cd => cd.id === customDeckId) || null;
}
export const getDeckCategoryById = (categoryId: DeckCategory['id']): DeckCategory | null => {
  return DECK_CATEGORIES.find(dc => dc.id === categoryId) || null;
}

export const getDisplayDataForCard = (themedDeckId: ThemeIdentifier, customDecks: CustomThemeData[]): { name: string; colorClass: string; visualStyle?: string } => {
  if (themedDeckId === 'OFFLINE') {
      return { name: OFFLINE_DECK.name, colorClass: 'from-slate-700 to-slate-800', visualStyle: OFFLINE_DECK.visualStyle };
  }
  if (themedDeckId.startsWith("CUSTOM_")) {
    const customDeck = getCustomDeckById(themedDeckId as CustomThemeId, customDecks);
    return { name: customDeck?.name || "Custom Card", colorClass: customDeck?.colorClass || "from-gray-500 to-gray-600" };
  }
  const deck = getThemedDeckById(themedDeckId as ThemedDeck['id']);
  if (deck) {
    return { 
        name: deck.name, 
        colorClass: DECK_CATEGORY_COLORS[deck.category] || "from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600",
        visualStyle: deck.visualStyle
    };
  }
  return { name: "Card", colorClass: "from-gray-500 to-gray-600" };
};

export const getStyleDirectiveForCard = (selectedVoiceName: VoiceName, isForCardBack: boolean, deck?: ThemedDeck | CustomThemeData | null): string => {
    const selectedPersona = CURATED_VOICE_PERSONAS.find(p => p.voiceName === selectedVoiceName) || CURATED_VOICE_PERSONAS.find(p => p.voiceName === DEFAULT_VOICE_NAME)!;
    const baseDirective = `Speak with the gentle, natural cadence reminiscent of ${selectedPersona.voiceAccentHint}. Your delivery should be unforced and sincere, like sharing a quiet thought with a friend. Avoid a performative or overly articulated style.`;
    let thematicToneDirective = "";
    if (isForCardBack) {
        thematicToneDirective = "Your tone is helpful and encouraging, but maintain a soft, conversational quality.";
    } else if (deck) {
        if (deck.intensity && deck.intensity.some(l => l >= 4)) {
            thematicToneDirective = "For this, adopt a very calm, steady, and grounded tone, creating a feeling of supportive quiet.";
        } else if (deck.themes && deck.themes.includes('Play & Creativity')) {
            thematicToneDirective = "A light, easy warmth should infuse your voice, as if sharing a private smile.";
        } else {
            thematicToneDirective = "Your tone should be warm and inviting.";
        }
    } else {
         thematicToneDirective = "Your tone should be warm and inviting.";
    }
    const cleanedDirective = thematicToneDirective.trim().replace(/\s\s+/g, ' ');
    const finalDirective = `${baseDirective} ${cleanedDirective} Now, speak the following:`;
    return finalDirective.trim().replace(/\s\s+/g, ' ');
};
