





import { GoogleGenAI, GenerateContentResponse, Chat, Content } from "@google/genai";
import { DevLogEntry } from "../components/DevLogSheet";

const API_KEY = process.env.API_KEY;
let ai: GoogleGenAI | null = null;
let chatSessions: { [name: string]: { session: Chat, systemInstruction: string } } = {};

if (API_KEY) {
  try {
    ai = new GoogleGenAI({ apiKey: API_KEY });
  } catch (error) {
    console.error("Failed to initialize GoogleGenAI:", error);
  }
}

export const PRIMARY_TEXT_GENERATION_MODEL = 'gemini-2.5-flash-preview-04-17';
export const FALLBACK_TEXT_GENERATION_MODEL = 'gemini-2.5-flash-preview-04-17'; 
const TTS_MODEL = 'gemini-2.5-flash-preview-tts'; 
const GENERATION_TIMEOUT_MS = 20000; // 20 seconds

let activeTextModel = PRIMARY_TEXT_GENERATION_MODEL;

const switchToFallbackModel = () => {
    if (activeTextModel === PRIMARY_TEXT_GENERATION_MODEL) {
        console.warn(`Switching to fallback model: ${FALLBACK_TEXT_GENERATION_MODEL}`);
        activeTextModel = FALLBACK_TEXT_GENERATION_MODEL;
    }
};

export const resetChatSession = () => {
    chatSessions = {};
    console.log("All chat sessions have been reset.");
};

export const performHealthCheck = async (addLogEntry?: (entry: DevLogEntry) => void): Promise<{ available: boolean; activeModel: string; error?: string; }> => {
    if (!ai) {
        const error = "Gemini AI not initialized.";
        addLogEntry?.({ type: 'health-check', requestTimestamp: Date.now(), responseTimestamp: Date.now(), data: { input: "Health Check Start", output: "Failed: AI not initialized", error } });
        return { available: false, activeModel: '', error };
    }

    const log = (status: string, model: string, error?: string) => {
        addLogEntry?.({ type: 'health-check', requestTimestamp: Date.now(), responseTimestamp: Date.now(), data: { input: `Checking model: ${model}`, output: status, error } });
    };
    
    const checkTTS = async () => {
        if (!ai) return;
        try {
            // For TTS, we must request an audio mime type.
            await ai.models.generateContent({
                model: TTS_MODEL,
                contents: 'healthcheck', // Simplified content
                config: {
                    ttsVoice: DEFAULT_VOICE_NAME,
                    responseMimeType: 'audio/l16; rate=24000',
                } as any,
            });
            log('Success', TTS_MODEL);
        } catch (e: any) {
            console.warn(`Health check failed for TTS model (${TTS_MODEL}). TTS features may not work as expected. Error: ${e.message}`);
            log('Failure', TTS_MODEL, e.message);
        }
    };


    // Try primary model
    try {
        await ai.models.generateContent({ model: PRIMARY_TEXT_GENERATION_MODEL, contents: [{ role: 'user', parts: [{ text: 'healthcheck' }] }] });
        activeTextModel = PRIMARY_TEXT_GENERATION_MODEL;
        const statusMessage = `Health check PASSED. Active model: ${activeTextModel}`;
        console.log(statusMessage);
        log('Success', PRIMARY_TEXT_GENERATION_MODEL, undefined);
        await checkTTS();
        return { available: true, activeModel: activeTextModel };
    } catch (e: any) {
        const primaryError = `Health check failed for primary model (${PRIMARY_TEXT_GENERATION_MODEL}). Error: ${e.message}. Trying fallback.`;
        console.warn(primaryError);
        log('Failure', PRIMARY_TEXT_GENERATION_MODEL, e.message);
        
        // Try fallback model
        try {
            await ai.models.generateContent({ model: FALLBACK_TEXT_GENERATION_MODEL, contents: [{ role: 'user', parts: [{ text: 'healthcheck' }] }] });
            activeTextModel = FALLBACK_TEXT_GENERATION_MODEL;
            const statusMessage = `Health check PASSED with fallback. Active model: ${activeTextModel}`;
            console.log(statusMessage);
            log('Success (Fallback)', FALLBACK_TEXT_GENERATION_MODEL, undefined);
            await checkTTS();
            return { available: true, activeModel: activeTextModel };
        } catch (e2: any) {
            const fallbackError = `Health check failed for fallback model (${FALLBACK_TEXT_GENERATION_MODEL}). Service unavailable. Error: ${e2.message}`;
            console.error(fallbackError);
            log('Failure', FALLBACK_TEXT_GENERATION_MODEL, e2.message);
            return { available: false, activeModel: '', error: "Both primary and fallback AI models are unavailable." };
        }
    }
};


// --- NEW RECIPE BUILDING BLOCKS ---

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
  socialContexts?: SocialContext[]; // Undefined means all are applicable
  ageGroups: AgeGroup[];
  visualStyle?: string;
}


// --- DATA DEFINITIONS BASED ON NEW RECIPE ---

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
    // INTRODUCTIONS
    {
        id: 'GENTLE_CURRENTS', name: 'Gentle Currents', category: 'INTRODUCTIONS',
        description: "Dipping a toe in the water. Light, safe, and connecting prompts to start any conversation with ease.",
        intensity: [1, 2],
        themes: ['Body & Sensation', 'Mind & Thoughts', 'Heart & Emotions', 'Light & Essence', 'Outer World', 'Past & Memory', 'Play & Creativity'],
        cardTypes: ['Question', 'Reflection'],
        ageGroups: ['Adults', 'Teens', 'Kids'],
    },
    {
        id: 'THE_ICEBREAKER', name: 'The Icebreaker', category: 'INTRODUCTIONS',
        description: "Fun, low-pressure prompts to build energy and instant rapport.",
        intensity: [1],
        themes: ['Play & Creativity', 'Outer World'],
        cardTypes: ['Wildcard', 'Directive', 'Question'],
        ageGroups: ['Adults', 'Teens', 'Kids'],
        socialContexts: ['GENERAL', 'STRANGERS', 'TEAM'],
    },
    // IMAGE OF SELF
    {
        id: 'LEGACY_VISION', name: 'Legacy & Vision', category: 'IMAGE_OF_SELF',
        description: "What are you building? Who are you becoming? Explore your goals, your impact, and the future you are creating.",
        intensity: [2, 3, 4],
        themes: ['Vision & Future', 'Light & Essence'],
        cardTypes: ['Question', 'Reflection'],
        ageGroups: ['Adults', 'Teens'],
    },
    {
        id: 'ROOTS_BRANCHES', name: 'Roots & Branches', category: 'IMAGE_OF_SELF',
        description: "Explore your personal history, family stories, and the memories that shaped you.",
        intensity: [2, 3, 4],
        themes: ['Past & Memory', 'Heart & Emotions'],
        cardTypes: ['Question', 'Reflection'],
        ageGroups: ['Adults', 'Teens'],
    },
    {
        id: 'INNER_CRITIC_SAGE', name: 'The Inner Critic & The Sage', category: 'IMAGE_OF_SELF',
        description: "Meet the voices within. Learn to distinguish your inner critic from your inner wisdom.",
        intensity: [2, 3, 4],
        themes: ['Parts & Voices', 'Mind & Thoughts'],
        cardTypes: ['Question', 'Practice'],
        ageGroups: ['Adults', 'Teens'],
    },
    {
        id: 'SOMATIC_SANCTUARY', name: 'Somatic Sanctuary', category: 'IMAGE_OF_SELF',
        description: "Your body is speaking. This deck is a quiet space to listen to its language of sensation and feeling.",
        intensity: [2, 3],
        themes: ['Body & Sensation', 'Heart & Emotions'],
        cardTypes: ['Directive', 'Practice', 'Question'],
        ageGroups: ['Adults', 'Teens', 'Kids'],
    },
    // INTIMACY & CONNECTION
    {
        id: 'EROS_ESSENCE', name: 'Eros & Essence', category: 'INTIMACY_CONNECTION',
        description: "Explore the landscape of desire, turn-on, and mindful intimacy, connecting sexuality to your core self.",
        intensity: [3, 4, 5],
        themes: ['Desire & Intimacy', 'Light & Essence'],
        cardTypes: ['Question', 'Directive', 'Reflection'],
        ageGroups: ['Adults'],
    },
    {
        id: 'DEEPENING_PARTNERSHIP', name: 'Deepening Partnership', category: 'INTIMACY_CONNECTION',
        description: "For established couples. Reconnect, navigate challenges, and build your shared future.",
        intensity: [2, 3, 4],
        themes: ['Heart & Emotions', 'Vision & Future', 'Shadow & Depth'],
        cardTypes: ['Question', 'Practice', 'Connector'],
        ageGroups: ['Adults'],
        socialContexts: ['ROMANTIC'],
    },
    {
        id: 'PLATONIC_INTIMACY', name: 'Platonic Intimacy', category: 'INTIMACY_CONNECTION',
        description: "For deep friendships. Explore the landscape of connection, care, and vulnerability that exists outside of romance.",
        intensity: [2, 3, 4],
        themes: ['Heart & Emotions', 'Light & Essence'],
        cardTypes: ['Question', 'Reflection'],
        ageGroups: ['Adults', 'Teens'],
        socialContexts: ['FRIENDS'],
    },
    {
        id: 'ATTRACTION_MAP', name: 'Attraction Map', category: 'INTIMACY_CONNECTION',
        description: "What truly captivates you? A solo or shared journey to map the full spectrum of your attractions—physical, emotional, intellectual, and spiritual.",
        intensity: [3, 4],
        themes: ['Desire & Intimacy', 'Mind & Thoughts', 'Spirit & Awe'],
        cardTypes: ['Question', 'Reflection'],
        ageGroups: ['Adults'],
        socialContexts: ['SOLO', 'ROMANTIC'],
    },
    {
        id: 'COURAGEOUS_REQUESTS', name: 'Courageous Requests', category: 'INTIMACY_CONNECTION',
        description: "Asking for what you want is a practice. A deck of sentence stems and prompts to help you voice your desires and needs clearly and kindly.",
        intensity: [3, 4],
        themes: ['Desire & Intimacy', 'Heart & Emotions'],
        cardTypes: ['Reflection', 'Practice'],
        ageGroups: ['Adults'], // Soft lock for teens, handled in UI
    },
    // EXTERNAL VIEWS
    {
        id: 'AWE_WONDER', name: 'Awe & Wonder', category: 'EXTERNAL_VIEWS',
        description: "Reconnect with mystery, meaning, and the sacred in everyday life. A journey into spirit and reverence.",
        intensity: [2, 3],
        themes: ['Spirit & Awe', 'Transcendence & Mystery'],
        cardTypes: ['Reflection', 'Question'],
        ageGroups: ['Adults', 'Teens'],
        visualStyle: 'celestial-bg',
    },
    {
        id: 'SOCIAL_MIRROR', name: 'Social Mirror', category: 'EXTERNAL_VIEWS',
        description: "Explore your relationship with culture, community, and the world around you.",
        intensity: [2, 3],
        themes: ['Outer World', 'Mind & Thoughts'],
        cardTypes: ['Question', 'Reflection'],
        ageGroups: ['Adults', 'Teens'],
    },
    {
        id: 'THE_ORACLE', name: 'The Oracle', category: 'EXTERNAL_VIEWS',
        description: "Wisdom through the ages. Reflect on quotes, poems, and koans to see what timeless truth speaks to you now.",
        intensity: [2, 3],
        themes: ['Spirit & Awe', 'Mind & Thoughts', 'Light & Essence'],
        cardTypes: ['Reflection'],
        ageGroups: ['Adults', 'Teens'],
    },
    // RELATIONAL
    {
        id: 'THE_CHECK_IN', name: 'The Check-in', category: 'RELATIONAL',
        description: "A quick ritual for teams or partners to touch base, clear the air, and connect on what's real.",
        intensity: [2],
        themes: ['Mind & Thoughts', 'Heart & Emotions'],
        cardTypes: ['Reflection', 'Question'],
        ageGroups: ['Adults', 'Teens'],
        socialContexts: ['FRIENDS', 'ROMANTIC', 'FAMILY', 'TEAM'],
    },
    {
        id: 'FIRST_IMPRESSIONS', name: 'First Impressions', category: 'RELATIONAL',
        description: "Go beyond surface-level facts. A deck to explore the perceptions, stories, and assumptions we form when we first meet.",
        intensity: [1, 2],
        themes: ['Play & Creativity', 'Mind & Thoughts', 'Light & Essence'],
        cardTypes: ['Question', 'Wildcard'],
        ageGroups: ['Adults', 'Teens'],
        socialContexts: ['STRANGERS', 'ROMANTIC'],
    },
    {
        id: 'FRIENDS_CIRCLE', name: "Friends' Circle", category: 'RELATIONAL',
        description: "The conversation you've been meaning to have. Go beyond the daily updates and strengthen your bond.",
        intensity: [2, 3],
        themes: ['Heart & Emotions', 'Past & Memory', 'Light & Essence', 'Vision & Future'],
        cardTypes: ['Question', 'Reflection', 'Connector'],
        ageGroups: ['Adults', 'Teens'],
        socialContexts: ['FRIENDS'],
    },
    {
        id: 'FAMILY_HEARTH', name: 'Family Hearth', category: 'RELATIONAL',
        description: "Share stories, appreciate one another, and bridge generations. A safe space for family connection.",
        intensity: [1, 2, 3],
        themes: ['Heart & Emotions', 'Past & Memory', 'Light & Essence'],
        cardTypes: ['Question', 'Reflection'],
        ageGroups: ['Adults', 'Teens', 'Kids'],
        socialContexts: ['FAMILY'],
    },
    {
        id: 'TEAM_KICK_OFF', name: 'Team Kick-off', category: 'RELATIONAL',
        description: "Start a project or a new team on a foundation of trust and clarity. Align on goals and working styles.",
        intensity: [1, 2],
        themes: ['Vision & Future', 'Light & Essence', 'Mind & Thoughts'],
        cardTypes: ['Question', 'Practice'],
        ageGroups: ['Adults', 'Teens'],
        socialContexts: ['TEAM'],
    },
    {
        id: 'PARENTING_PARTNERS', name: 'Parenting Partners', category: 'RELATIONAL',
        description: "Navigate the journey of parenthood together. A space to share the joys, challenges, and your vision for your family.",
        intensity: [2, 3, 4],
        themes: ['Heart & Emotions', 'Shadow & Depth', 'Vision & Future'],
        cardTypes: ['Question', 'Practice'],
        ageGroups: ['Adults'],
        socialContexts: ['ROMANTIC'],
    },
    {
        id: 'KIDS_TABLE', name: "Kid's Table", category: 'RELATIONAL',
        description: "Spark imagination and encourage big feelings. Fun questions and activities for young minds and hearts.",
        intensity: [1, 2],
        themes: ['Play & Creativity', 'Heart & Emotions', 'Mind & Thoughts'],
        cardTypes: ['Question', 'Directive'],
        ageGroups: ['Kids'],
    },
    {
        id: 'TEEN_CAMPFIRE', name: 'Teen Campfire', category: 'RELATIONAL',
        description: "Real talk for real life. Explore identity, friendships, and the future in a space that gets it.",
        intensity: [2, 3],
        themes: ['Mind & Thoughts', 'Light & Essence', 'Outer World', 'Heart & Emotions'],
        cardTypes: ['Question', 'Reflection'],
        ageGroups: ['Teens'],
    },
    // IMAGINATIVE
    {
        id: 'THE_WRITERS_ROOM', name: "The Writer's Room", category: 'IMAGINATIVE',
        description: "A deck of creative kindling. Sentence stems and fill-in-the-blanks to bypass the blank page and start writing.",
        intensity: [2, 3],
        themes: ['Play & Creativity', 'Mind & Thoughts', 'Past & Memory'],
        cardTypes: ['Reflection'],
        ageGroups: ['Adults', 'Teens'],
        socialContexts: ['SOLO'],
    },
    {
        id: 'THE_DILEMMA_ENGINE', name: 'The Dilemma Engine', category: 'IMAGINATIVE',
        description: "Choose your path. A series of intriguing dilemmas that reveal values, priorities, and hidden beliefs.",
        intensity: [2, 3],
        themes: ['Mind & Thoughts', 'Light & Essence', 'Outer World'],
        cardTypes: ['Question'],
        ageGroups: ['Adults', 'Teens'],
    },
    {
        id: 'THE_DREAM_FACTORY', name: 'The Dream Factory', category: 'IMAGINATIVE',
        description: "A launchpad for imagination. Prompts to generate ideas, play with possibilities, and create something new.",
        intensity: [2, 3],
        themes: ['Play & Creativity', 'Vision & Future'],
        cardTypes: ['Directive', 'Wildcard'],
        ageGroups: ['Adults', 'Teens', 'Kids'],
    },
    {
        id: 'PATTERN_INTERRUPT', name: 'Pattern Interrupt', category: 'IMAGINATIVE',
        description: "Feeling stuck or too heavy? Draw from this deck to shift the energy with a jolt of playfulness or a fresh perspective.",
        intensity: [1, 2],
        themes: ['Play & Creativity', 'Mind & Thoughts'],
        cardTypes: ['Wildcard', 'Question'],
        ageGroups: ['Adults', 'Teens', 'Kids'],
    },
    // EDGY CONFRONTATIONS
    {
        id: 'THE_SHADOW_CABINET', name: 'The Shadow Cabinet', category: 'EDGY_CONFRONTATIONS',
        description: "What we hide holds power. A courageous exploration of triggers, shame, and the unowned parts of yourself.",
        intensity: [3, 4],
        themes: ['Shadow & Depth', 'Parts & Voices'],
        cardTypes: ['Question', 'Reflection'],
        ageGroups: ['Adults', 'Teens'],
        visualStyle: 'noir-bg',
    },
    {
        id: 'ON_THE_EDGE', name: 'On The Edge', category: 'EDGY_CONFRONTATIONS',
        description: "For conversations that matter. Explore charged topics, withheld truths, and challenging perspectives with intention.",
        intensity: [4],
        themes: ['Shadow & Depth', 'Desire & Intimacy', 'Heart & Emotions'],
        cardTypes: ['Question', 'Directive'],
        ageGroups: ['Adults'],
    },
    {
        id: 'NO_MASKS', name: 'No Masks', category: 'EDGY_CONFRONTATIONS',
        description: "A space for radical honesty and unfiltered expression. For those ready to meet the depths without reservation.",
        intensity: [5],
        themes: ['Shadow & Depth', 'Desire & Intimacy', 'Heart & Emotions', 'Light & Essence', 'Transcendence & Mystery'],
        cardTypes: ['Question', 'Directive'],
        ageGroups: ['Adults'],
    },
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
  // --- Female Personas (unchanged) ---
  { 
	  id: "voice_shohreh",
	  name: "The Oracle (Shohreh)",
	  gender: "Female",
	  voiceName: "Vindemiatrix",
	  description: "A deep, resonant voice that carries a sense of wisdom and authority.",
	  keywords: "deep, resonant, wise, authoritative, gravelly",
	  voiceAccentHint: "a deep, resonant, hypnotic Persian rhythm, commanding yet motherly tone reminiscent of Shohreh Aghdashloo" 
	},
  { 
	  id: "voice_michelle", 
	  name: "The Mentor (Michelle)", 
	  gender: "Female", 
	  voiceName: "Sulafat", 
	  description: "A calm, elegant voice with a warm, clear, and reassuring delivery.", 
	  keywords: "elegant, calm, clear, warm, reassuring", 
	  voiceAccentHint: "a calm, smooth, gentle, and clear tone, elegant but never stiff, subtle Malaysian lilt, reminiscent of Michelle Yeoh" 
	},
  { 
	  id: "voice_rihanna", 
	  name: "The Muse (Rihanna)", 
	  gender: "Female", 
	  voiceName: "Fenrir", // Placeholder as Zephyr is not a valid voice
	  description: "A cool, smooth voice with a confident, playful, and musical lilt.", 
	  keywords: "cool, smooth, playful, musical, confident", 
	  voiceAccentHint: "a cool, smooth, and playful tone with a husky-bright swing, raw Bajan real warmth, musical and island lilt reminiscent of Rihanna" },
  
  // --- Male Personas (updated) ---
  { 
    id: "voice_diego", 
    name: "The Thinker (Diego)", // Was The Companion
    gender: "Male", 
    voiceName: "Enceladus", 
    description: "A warm, thoughtful voice with a gentle, musing cadence that feels both intelligent and sincere.", 
    keywords: "warm, thoughtful, steady, sincere, gentle, musing", 
    voiceAccentHint: "a warm, thoughtful, husky and steady tone with a mellow Mexican cadence, and rounded authentic and unpolished edge, reminiscent of Diego Luna" 
  },
  { 
    id: "voice_trevor", 
    name: "The Companion (Trevor)", // Was The Jester
    gender: "Male", 
    voiceName: "Zubenelgenubi", 
    description: "An upbeat, warm voice with a clear, charismatic, and friendly intonation.", 
    keywords: "upbeat, warm, engaging, charismatic, clear, friendly", 
    voiceAccentHint: "a warm lilt, smooth with subtle playful pitch swings, yet with South African earthy edge, reminiscent of Trevor Noah" 
  },
  { 
    id: "voice_riz", 
    name: "The Catalyst (Riz)", // Was The Thinker, renamed from Jester
    gender: "Male", 
    voiceName: "Puck", 
    description: "A clear, rhythmic voice that feels energetic, witty, and engaging, perfect for sparking new ideas.", 
    keywords: "rhythmic, clear, witty, engaging, articulate, energetic", 
    voiceAccentHint: "Slight rasp, calm staccato consonants, British-Asian, sometimes East London, inflections, earthy, alive and witty tone reminiscent of Riz Ahmed" 
  },
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


export const getVisibleDecks = (
    groupSetting: SocialContext, 
    ageFilters: AgeFilters, 
    intensityFilters: IntensityLevel[],
    forceShowAll: boolean = false
): ThemedDeck[] => {
    if (forceShowAll) return ALL_THEMED_DECKS;
    
    return ALL_THEMED_DECKS.filter(deck => {
        // Hide special decks from normal view
        if (deck.category === 'SPECIALS') return false;

        // Age Group Filtering (Hard Lock)
        const activeAgeGroups: AgeGroup[] = [];
        if (ageFilters.adults) activeAgeGroups.push('Adults');
        if (ageFilters.teens) activeAgeGroups.push('Teens');
        if (ageFilters.kids) activeAgeGroups.push('Kids');
        
        const isAgeMatch = deck.ageGroups.some(ag => activeAgeGroups.includes(ag));
        if (!isAgeMatch) return false;

        // Intensity Filtering (Hard Lock)
        if (ageFilters.teens || ageFilters.kids) {
            if (deck.intensity.some(level => level >= 4)) return false;
        }

        // Intensity Filtering (Soft filter - if any level matches)
        if (intensityFilters.length > 0 && !deck.intensity.some(level => intensityFilters.includes(level))) {
            return false;
        }

        // Social Context Filtering
        if (deck.socialContexts && !deck.socialContexts.includes(groupSetting)) {
            return false;
        }

        // Romantic + Kids check
        if (groupSetting === 'ROMANTIC' && (ageFilters.teens || ageFilters.kids)) {
            // This is handled in the UI, but as a safeguard:
            // Could add logic here if specific decks are incompatible, but for now the global rule is sufficient.
        }

        return true;
    });
};

export const getThemedDeckById = (deckId: ThemedDeck['id']): ThemedDeck | null => {
  if (deckId === 'WOAH_DUDE') return WOAH_DUDE_DECK;
  return ALL_THEMED_DECKS.find(d => d.id === deckId) || null;
}
export const getCustomDeckById = (customDeckId: CustomThemeId, customDecks: CustomThemeData[]): CustomThemeData | null => {
  return customDecks.find(cd => cd.id === customDeckId) || null;
}
export const getDeckCategoryById = (categoryId: DeckCategory['id']): DeckCategory | null => {
  return DECK_CATEGORIES.find(dc => dc.id === categoryId) || null;
}

export const getDisplayDataForCard = (
  themedDeckId: ThemeIdentifier, 
  customDecks: CustomThemeData[]
): { name: string; colorClass: string; visualStyle?: string } => {
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

export const getStyleDirectiveForCard = (
    selectedVoiceName: VoiceName,
    isForCardBack: boolean,
    deck?: ThemedDeck | CustomThemeData | null
): string => {
    const selectedPersona = CURATED_VOICE_PERSONAS.find(p => p.voiceName === selectedVoiceName) 
        || CURATED_VOICE_PERSONAS.find(p => p.voiceName === DEFAULT_VOICE_NAME)!;
    
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


export const CARD_FRONT_PROMPT_START_TAG = "<card_front_prompt>";
export const CARD_FRONT_PROMPT_END_TAG = "</card_front_prompt>";
export const ACTIVITY_PROMPT_START_TAG = "<activity_prompt>";
export const ACTIVITY_PROMPT_END_TAG = "</activity_prompt>";
export const REFLECTION_PROMPT_START_TAG = "<reflection_prompt>";
export const REFLECTION_PROMPT_END_TAG = "</reflection_prompt>";
export const DURATION_START_TAG = "<duration>";
export const DURATION_END_TAG = "</duration>";
const CARD_BACK_NOTES_START_TAG = "<card_back_notes>";
const CARD_BACK_NOTES_END_TAG = "</card_back_notes>";

const getChatSession = (sessionName: string, systemInstruction: string, addLogEntry?: (entry: DevLogEntry) => void): Chat => {
    if (!ai) throw new Error("Gemini AI not initialized. Check API Key.");

    const cachedSession = chatSessions[sessionName];

    if (!cachedSession || cachedSession.systemInstruction !== systemInstruction) {
        if (cachedSession) {
            console.log(`System instruction for '${sessionName}' session changed. Initializing new chat session.`);
        } else {
            console.log(`Initializing new chat session for '${sessionName}'.`);
        }

        const newSessionData = {
            session: ai.chats.create({
                model: activeTextModel,
                config: { systemInstruction },
            }),
            systemInstruction: systemInstruction,
        };
        chatSessions[sessionName] = newSessionData;
        
        if (addLogEntry && sessionName === 'cardFront') {
            addLogEntry({
                type: 'session-init',
                requestTimestamp: Date.now(),
                responseTimestamp: Date.now(),
                data: {
                    input: "Chat Session Initialization",
                    output: { model: activeTextModel, systemInstruction }
                }
            });
        }
    }
    return chatSessions[sessionName].session;
};


export const getChatSessionHistory = async (): Promise<Content[]> => {
    try {
        const cardFrontSession = chatSessions['cardFront'];
        if (!cardFrontSession) return [];
        return await cardFrontSession.session.getHistory();
    } catch (e) {
        console.error("Could not retrieve chat history:", e);
        return [];
    }
};

const constructSystemInstructionForCardFront = (): string => {
  return `
**Task:** Generate a reflective prompt based on the user's JSON context.

**Output Rules (Strict):**
Your entire response MUST contain ONLY the prompt in one of the two formats below, followed by the narration JSON object. Do not add any other text or explanations.

1.  **Standard Prompt (Default):**
    <card_front_prompt>A single, concise question or directive under 25 words.</card_front_prompt>

2.  **Activity Prompt (For 'Practice'/'Directive' decks ONLY):**
    You may occasionally use this 3-tag format for activities.
    <activity_prompt>Short activity prompt. State duration inside if timed (e.g., "...for 30 seconds").</activity_prompt>
    <reflection_prompt>Follow-up question for after the activity.</reflection_prompt>
    <duration>A number in seconds. Use 0 for a non-timed, multi-part activity.</duration>

**Content Rules:**
- The prompt's content and tone must strictly match the provided \`deck\` name, themes, and \`intensity\`.
- Prompts must be a single, clear action.
- For 'The Oracle' deck, the prompt must be a direct quote.
- Review conversation history to ensure variety.

**Narration JSON (Mandatory):**
After the prompt tags, you MUST provide a JSON object in this exact format.
\`\`\`json
{
  "input": {
    "ttsInput": "Speak with [Persona Hint from input]. Your delivery should be natural and unforced. [Add specific emotional direction]. Now, speak: \\"[Repeat the exact card_front_prompt or activity_prompt text here]\\"",
    "voice": "[The 'voice' from the voicePersona object]"
  }
}
\`\`\`
  `.trim().replace(/^\s+/gm, '');
};

const constructSystemInstructionForCardBack = (): string => {
    return `
**Core Identity:** You are a helpful guide, providing context and depth for a reflection prompt. Your voice is insightful and encouraging.
**Core Task:** The user will provide a card front prompt. Your job is to generate the corresponding "Card Back Notes" for it.
**Contextual Awareness (CRITICAL):** The user might provide a \`contextPrompt\`. This means the main \`cardFrontText\` is a reflection on that initial activity. If a \`contextPrompt\` exists, your primary goal MUST be to bridge the two prompts. Your guidance should explain how the reflection (\`cardFrontText\`) builds upon or clarifies the experience of the initial activity (\`contextPrompt\`).
**Output Requirements (Strictly Adhere to Tags and Headings):**
Your entire response must be enclosed in ${CARD_BACK_NOTES_START_TAG} and ${CARD_BACK_NOTES_END_TAG} tags. Inside, you MUST generate 1-2 sentences for EACH of the following four sections, using the exact headings with markdown bolding.

${CARD_BACK_NOTES_START_TAG}
**The Idea:**
[Your text for The Idea: Briefly explain the core concept or purpose behind the prompt.]
**Getting Started:**
[Your text for Getting Started: Offer a simple, concrete first step to engage with the prompt.]
**Deeper Dive:**
[Your text for Deeper Dive: Suggest a way to explore the prompt more deeply or from a different angle.]
**Explore Further:**
[Optional: If relevant, suggest 1-2 resources like a specific book, a well-known teacher/thinker, or a type of practice. Be concise. AVOID URLs.]
${CARD_BACK_NOTES_END_TAG}
    `.trim();
};

const constructUserMessageForCardFront = (
  selectedDeck: ThemedDeck | CustomThemeData, 
  groupSetting: SocialContext,
  participantCount: number, 
  participantNames: string[],
  activeParticipantName: string | null,
  ageFilters: AgeFilters,
  selectedVoiceName: VoiceName,
  languageCode: LanguageCode,
  historyLength: number,
  redrawContext?: { disliked: boolean }
): string => {
  
  const deckContext: any = { name: selectedDeck.name };
  if ('category' in selectedDeck) {
    const category = getDeckCategoryById(selectedDeck.category);
    if (category) deckContext.category = category.name;
  }
  
  // Consolidate properties from either ThemedDeck or CustomThemeData if they exist
  if ('themes' in selectedDeck && selectedDeck.themes && selectedDeck.themes.length > 0) {
      deckContext.themes = selectedDeck.themes;
  }
  if ('cardTypes' in selectedDeck && selectedDeck.cardTypes && selectedDeck.cardTypes.length > 0) {
      deckContext.cardTypes = selectedDeck.cardTypes;
  }
  if ('intensity' in selectedDeck && selectedDeck.intensity && selectedDeck.intensity.length > 0) {
      deckContext.intensity = selectedDeck.intensity;
  }
  if ('description' in selectedDeck && selectedDeck.description) {
      deckContext.description = selectedDeck.description;
  }

  const activeAgeGroups: AgeGroup[] = [];
  if (ageFilters.adults) activeAgeGroups.push('Adults');
  if (ageFilters.teens) activeAgeGroups.push('Teens');
  if (ageFilters.kids) activeAgeGroups.push('Kids');
    
  const socialContext = {
      setting: groupSetting,
      participantCount: participantCount,
      participants: participantNames,
      activeParticipant: activeParticipantName,
      ageGroups: activeAgeGroups,
  };

  const selectedPersona = CURATED_VOICE_PERSONAS.find(p => p.voiceName === selectedVoiceName) 
        || CURATED_VOICE_PERSONAS.find(p => p.voiceName === DEFAULT_VOICE_NAME)!;
    
  const payload = {
    deck: deckContext,
    socialContext: socialContext,
    voicePersona: {
        name: selectedPersona.name,
        voice: selectedPersona.voiceName,
        hint: selectedPersona.voiceAccentHint
    },
    language: languageCode,
    historyLength: historyLength,
    redraw: redrawContext?.disliked ?? false,
    firstCard: historyLength === 0 && !redrawContext?.disliked,
  };
  
  const jsonPayload = JSON.stringify(payload, null, 2);
  
  return `Here is the creative context for this draw:\n${jsonPayload}`;
};

function parseLlmResponse(
    fullLlmOutput: string
): { text: string; reflectionText: string | null; timerDuration: number | null, rawLlmOutput: string; ttsInput: string | null; ttsVoice: VoiceName | null; } {
    let promptText: string | null = null;
    const processedOutput = fullLlmOutput;

    let reflectionText: string | null = null;
    let timerDuration: number | null = null;
    let ttsInput: string | null = null;
    let ttsVoice: VoiceName | null = null;
    
    const activityMatch = processedOutput.match(new RegExp(`${ACTIVITY_PROMPT_START_TAG}([\\s\\S]*?)${ACTIVITY_PROMPT_END_TAG}`));
    const reflectionMatch = processedOutput.match(new RegExp(`${REFLECTION_PROMPT_START_TAG}([\\s\\S]*?)${REFLECTION_PROMPT_END_TAG}`));
    const cardFrontMatch = processedOutput.match(new RegExp(`${CARD_FRONT_PROMPT_START_TAG}([\\s\\S]*?)${CARD_FRONT_PROMPT_END_TAG}`));

    if (activityMatch && reflectionMatch) {
        promptText = activityMatch[1].trim();
        reflectionText = reflectionMatch[1].trim();
        const durationMatch = processedOutput.match(new RegExp(`${DURATION_START_TAG}(\\d+)${DURATION_END_TAG}`));
        timerDuration = durationMatch ? parseInt(durationMatch[1], 10) : null;
    } else if (cardFrontMatch) {
        promptText = cardFrontMatch[1].trim();
    }
    
    let jsonString: string | null = null;
    const jsonFenceMatch = processedOutput.match(/```json\s*([\s\\S]*?)\s*```/s);

    if (jsonFenceMatch && jsonFenceMatch[1]) {
        jsonString = jsonFenceMatch[1];
    } else {
        const jsonStart = processedOutput.lastIndexOf('{');
        if (jsonStart !== -1) {
            const jsonEnd = processedOutput.lastIndexOf('}');
            if (jsonEnd > jsonStart) {
                jsonString = processedOutput.substring(jsonStart, jsonEnd + 1);
            }
        }
    }

    if (jsonString) {
        try {
            const parsedJson = JSON.parse(jsonString);
            if (parsedJson.input && typeof parsedJson.input.ttsInput === 'string' && typeof parsedJson.input.voice === 'string') {
                ttsInput = parsedJson.input.ttsInput;
                const voice = parsedJson.input.voice as VoiceName;
                if (CURATED_VOICE_PERSONAS.some(p => p.voiceName === voice)) {
                    ttsVoice = voice;
                } else {
                    console.warn(`LLM returned an invalid voice name: ${voice}. Defaulting.`);
                    ttsVoice = DEFAULT_VOICE_NAME;
                }
            }
        } catch (e) {
            console.error("Failed to parse TTS JSON from LLM response:", e, "JSON string:", jsonString);
        }
    }
    
    if (!promptText) {
        const cleanedFallback = processedOutput
            .replace(/```json[\s\S]*?```/s, "")
            .replace(/{[\s\S]*?}/s, "")
            .replace(/<[^>]+>/g, "")
            .trim();
        
        if (cleanedFallback) {
            console.warn("Could not parse a primary prompt tag. Using cleaned LLM output as fallback.", { fullLlmOutput });
            promptText = cleanedFallback;
        } else {
            console.error("Could not parse any valid text from the LLM output.", { fullLlmOutput });
            throw new Error("The AI returned an incomplete or invalid response. Please try drawing again.");
        }
    }

    return { text: promptText, reflectionText, timerDuration, rawLlmOutput: fullLlmOutput, ttsInput, ttsVoice };
}

export const generateCardFront = async (
    selectedDeck: ThemedDeck | CustomThemeData,
    groupSetting: SocialContext,
    participantCount: number,
    participantNames: string[],
    activeParticipantName: string | null,
    ageFilters: AgeFilters,
    selectedVoiceName: VoiceName,
    languageCode: LanguageCode,
    historyLength: number,
    addLogEntry: (entry: DevLogEntry) => void,
    redrawContext?: { disliked: boolean }
): Promise<{ 
    text: string | null; 
    reflectionText: string | null; 
    timerDuration: number | null;
    ttsInput: string | null;
    ttsVoice: VoiceName | null;
    rawLlmOutput: string | null; 
    error: string | null;
    requestTimestamp: number;
    responseTimestamp: number;
    inputPrompt: string;
}> => {
    const requestTimestamp = Date.now();
    const systemInstruction = constructSystemInstructionForCardFront();
    
    const userPrompt = constructUserMessageForCardFront(
        selectedDeck, groupSetting, participantCount, participantNames, activeParticipantName,
        ageFilters, selectedVoiceName, languageCode, historyLength, redrawContext
    );

    try {
        if (!ai) throw new Error("AI service not available.");

        const chat = getChatSession('cardFront', systemInstruction, addLogEntry);
        
        const response: GenerateContentResponse = await Promise.race([
            chat.sendMessage({ message: userPrompt }),
            new Promise<any>((_, reject) => 
                setTimeout(() => reject(new Error("Generation timed out")), GENERATION_TIMEOUT_MS)
            )
        ]);

        if (!response) {
             throw new Error("Generation timed out or returned no response.");
        }
        
        const { text, reflectionText, timerDuration, rawLlmOutput, ttsInput, ttsVoice } = parseLlmResponse(response.text);
        
        return {
            text, reflectionText, timerDuration, rawLlmOutput, ttsInput, ttsVoice,
            error: null, requestTimestamp, responseTimestamp: Date.now(), inputPrompt: userPrompt
        };

    } catch (e: any) {
        console.error("Error generating card front:", e);
        if (e.message.includes("timed out")) {
            switchToFallbackModel();
        }
        return { 
            text: null, reflectionText: null, timerDuration: null,
            rawLlmOutput: null, ttsInput: null, ttsVoice: null,
            error: e.message || "An unknown error occurred during generation.",
            requestTimestamp, responseTimestamp: Date.now(), inputPrompt: userPrompt
        };
    }
};

export const generateCardBack = async (
    cardFrontText: string,
    deckContext: ThemedDeck | CustomThemeData,
    contextPrompt?: string | null
): Promise<{
    cardBackNotesText: string | null;
    rawLlmOutput: string | null;
    error: string | null;
    requestTimestamp: number;
    responseTimestamp: number;
    inputPrompt: string;
}> => {
    const requestTimestamp = Date.now();
    let userPrompt = `The card front prompt is: "${cardFrontText}".`;

    if (contextPrompt) {
        userPrompt += ` This is a reflection on a previous activity. The prompt for that activity was: "${contextPrompt}".`;
    }

    const deckInfo = ` It is from a deck with the context: "Themes: ${'themes' in deckContext ? deckContext.themes?.join(', ') : 'N/A'}".`;
    userPrompt += deckInfo;
    
    if (!ai) {
        return { cardBackNotesText: null, rawLlmOutput: null, error: "AI service not available.", requestTimestamp, responseTimestamp: Date.now(), inputPrompt: userPrompt };
    }

    const systemInstruction = constructSystemInstructionForCardBack();
    const chat = getChatSession('cardBack', systemInstruction);

    try {
        const response: GenerateContentResponse = await Promise.race([
             chat.sendMessage({ message: userPrompt }),
             new Promise<any>((_, reject) => setTimeout(() => reject(new Error("Card back generation timed out")), GENERATION_TIMEOUT_MS))
        ]);

        const fullText = response.text;
        const notesMatch = fullText.match(new RegExp(`${CARD_BACK_NOTES_START_TAG}([\\s\\S]*?)${CARD_BACK_NOTES_END_TAG}`));
        
        const cardBackNotes = notesMatch ? notesMatch[1].trim() : fullText.trim();
        
        return { 
            cardBackNotesText: cardBackNotes, 
            rawLlmOutput: fullText,
            error: null,
            requestTimestamp,
            responseTimestamp: Date.now(),
            inputPrompt: userPrompt
        };

    } catch (e: any) {
        console.error("Error generating card back:", e);
        return { 
            cardBackNotesText: null, 
            rawLlmOutput: null,
            error: e.message || "An unknown error occurred during card back generation.",
            requestTimestamp,
            responseTimestamp: Date.now(),
            inputPrompt: userPrompt
        };
    }
};

interface AudioGenerationResult {
    audioData: string | null;
    audioMimeType: string | null;
    error: string | null;
    requestTimestamp: number;
    responseTimestamp: number;
    logData: {
        input: string;
        output: string;
    }
}

export const generateAudioForText = async (
    textToSpeak: string,
    voiceName: VoiceName,
    styleDirective: string | null
): Promise<AudioGenerationResult> => {
    const requestTimestamp = Date.now();
    const fullPrompt = styleDirective ? `${styleDirective} "${textToSpeak}"` : textToSpeak;
    
    const logData = { input: fullPrompt, output: "" };

    if (!ai) {
        return { audioData: null, audioMimeType: null, error: "AI service not available.", requestTimestamp, responseTimestamp: Date.now(), logData };
    }

    try {
        const result = await Promise.race([
            ai.models.generateContent({
                model: TTS_MODEL,
                contents: fullPrompt, // Simplified content
                config: {
                    ttsVoice: voiceName,
                    responseMimeType: 'audio/l16; rate=24000',
                } as any
            }),
            new Promise<null>((_, reject) => 
                setTimeout(() => reject(new Error("TTS generation timed out")), GENERATION_TIMEOUT_MS)
            )
        ]);

        if (!result) {
            throw new Error("TTS generation timed out");
        }
        
        const audioPart = result.candidates?.[0]?.content.parts.find(p => 'audio' in p);

        if (audioPart && 'audio' in audioPart) {
            logData.output = `Success: Received ${(audioPart as any).audio.data.length} bytes of audio data.`;
            return {
                audioData: (audioPart as any).audio.data,
                audioMimeType: (result.candidates?.[0]?.content as any)?.mimeType ?? 'audio/l16; rate=24000',
                error: null,
                requestTimestamp,
                responseTimestamp: Date.now(),
                logData
            };
        } else {
            throw new Error("No audio data received from the API.");
        }
    } catch (e: any) {
        console.error("Error generating audio:", e);
        logData.output = `Error: ${e.message}`;
        return {
            audioData: null, audioMimeType: null,
            error: e.message || "An unknown error occurred during audio generation.",
            requestTimestamp, responseTimestamp: Date.now(), logData
        };
    }
};


export const sendFeedbackToChat = async (cardText: string, feedback: 'liked' | 'disliked', addLogEntry: (entry: DevLogEntry) => void): Promise<void> => {
    const cardFrontSession = chatSessions['cardFront'];
    if (!cardFrontSession) {
        console.warn("Cannot send feedback: chat session not initialized.");
        return;
    }

    const requestTimestamp = Date.now();
    const feedbackPrompt = `User feedback for the prompt "${cardText}": ${feedback}.`;
    
    try {
        await cardFrontSession.session.sendMessage({ message: feedbackPrompt });
        addLogEntry({
            type: 'user-feedback',
            requestTimestamp,
            responseTimestamp: Date.now(),
            data: {
                input: feedbackPrompt,
                output: "Feedback acknowledged by the model."
            }
        });
    } catch (e: any) {
        console.error("Error sending feedback to chat:", e);
        addLogEntry({
            type: 'user-feedback',
            requestTimestamp,
            responseTimestamp: Date.now(),
            data: {
                input: feedbackPrompt,
                output: "Failed to send feedback.",
                error: e.message
            }
        });
    }
};