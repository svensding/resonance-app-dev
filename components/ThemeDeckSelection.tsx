
import React, { useMemo } from 'react';
import { 
    ThemeIdentifier, CustomThemeData, ThemedDeck,
    getVisibleDecks,
    SocialContext,
    AgeFilters,
    IntensityLevel,
    DECK_CATEGORIES,
    getDisplayDataForCard,
    WOAH_DUDE_DECK,
    OFFLINE_DECK
} from '../services/geminiService';
import { ThemedDeckButton } from './ThemedDeckButton';
import { useDragToScroll } from '../hooks/useDragToScroll'; 
import { Participant } from './BottomToolbar';

interface ThemeDeckSelectionProps {
  onDraw: (itemId: ThemedDeck['id'] | CustomThemeData['id'] | "RANDOM" | `CATEGORY_${string}`) => void;
  isDrawingInProgress?: boolean;
  interactionsDisabled?: boolean;
  customDecks: CustomThemeData[];
  onAddCustomDeck: () => void;
  onEditCustomDeck: (deck: CustomThemeData) => void; 
  onShowDeckInfo: (itemId: ThemedDeck['id'] | CustomThemeData['id']) => void;
  groupSetting: SocialContext;
  ageFilters: AgeFilters;
  intensityFilters: IntensityLevel[];
  participants: Participant[];
  showAllDecks?: boolean;
  isOfflineMode?: boolean;
  onRetryConnection?: () => void;
}

export const ThemeDeckSelection: React.FC<ThemeDeckSelectionProps> = ({ 
    onDraw, 
    isDrawingInProgress = false,
    interactionsDisabled = false,
    customDecks, 
    onAddCustomDeck,
    onEditCustomDeck,
    onShowDeckInfo,
    groupSetting,
    ageFilters,
    intensityFilters,
    participants,
    showAllDecks = false,
    isOfflineMode = false,
    onRetryConnection,
}) => {
  const scrollContainerRef = useDragToScroll<HTMLDivElement>(); 

  const deckButtonContainerStyle = "flex-shrink-0 h-full aspect-[5/7]";
  const drawActionDisabled = isDrawingInProgress || interactionsDisabled;
  const utilityActionsDisabled = interactionsDisabled;

  const isStonerMode = useMemo(() => 
    participants.some(p => p.name.toLowerCase().trim() === 'stoner'),
    [participants]
  );

  const visibleDecks = useMemo(() => getVisibleDecks(groupSetting, ageFilters, intensityFilters, showAllDecks), [groupSetting, ageFilters, intensityFilters, showAllDecks]);

  const categorizedDecks = useMemo(() => {
    const categories: { category: typeof DECK_CATEGORIES[0]; decks: ThemedDeck[] }[] = [];
    DECK_CATEGORIES.forEach(cat => {
      if (cat.id === 'SPECIALS') return; // Skip special decks in normal categorization
      const decksInCategory = visibleDecks.filter(deck => deck.category === cat.id);
      if (decksInCategory.length > 0) {
        categories.push({ category: cat, decks: decksInCategory });
      }
    });
    return categories;
  }, [visibleDecks]);

  if (isOfflineMode) {
      return (
        <div className="w-full h-full flex items-center justify-center p-2 sm:p-3 relative bg-transparent" > 
            <div className="flex items-center justify-center gap-6 sm:gap-8 max-w-3xl w-full">
                {/* Offline Deck Button */}
                <div className={`${deckButtonContainerStyle} w-32 sm:w-40`}>
                    <ThemedDeckButton
                        itemId={OFFLINE_DECK.id}
                        itemName={OFFLINE_DECK.name}
                        colorClass={getDisplayDataForCard(OFFLINE_DECK.id, customDecks).colorClass}
                        onDrawClick={() => onDraw(OFFLINE_DECK.id)}
                        drawActionDisabled={drawActionDisabled}
                        utilityActionsDisabled={utilityActionsDisabled}
                        onShowInfo={() => onShowDeckInfo(OFFLINE_DECK.id)}
                        isDeckSet={true}
                        visualStyle={OFFLINE_DECK.visualStyle}
                    />
                </div>

                {/* Error & Retry UI */}
                <div className="flex flex-col justify-center items-start text-amber-100/90 max-w-xs space-y-3">
                    <div>
                        <h4 className="text-sm sm:text-base font-bold text-amber-400 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            Connection Interrupted
                        </h4>
                        <p className="text-xs sm:text-sm mt-1 leading-snug">
                            We can't reach the AI service right now. Switched to <strong className="text-amber-200">Offline Mode</strong> so you can keep the conversation going.
                        </p>
                    </div>
                    {onRetryConnection && (
                        <button 
                            onClick={onRetryConnection} 
                            className="text-xs sm:text-sm bg-amber-800/60 hover:bg-amber-700 text-amber-100 px-4 py-2 rounded-md transition-colors border border-amber-600/30 whitespace-nowrap font-semibold shadow-sm"
                        >
                            Try Reconnecting
                        </button>
                    )}
                </div>
            </div>
        </div>
      );
  }

  return (
    <div className="w-full h-full flex items-center p-2 sm:p-3 relative bg-transparent" > 
      <div 
        ref={scrollContainerRef} 
        className="flex h-full overflow-x-auto hide-scrollbar space-x-3 sm:space-x-4 justify-start items-center cursor-grab active:cursor-grabbing bg-transparent w-full"
        style={{ isolation: 'isolate' }} 
      >
        {isStonerMode && (
           <div key="WOAH_DUDE" className={deckButtonContainerStyle}>
                <ThemedDeckButton
                    itemId={WOAH_DUDE_DECK.id}
                    itemName={WOAH_DUDE_DECK.name}
                    colorClass={getDisplayDataForCard(WOAH_DUDE_DECK.id, customDecks).colorClass}
                    onDrawClick={() => onDraw(WOAH_DUDE_DECK.id)}
                    drawActionDisabled={drawActionDisabled}
                    utilityActionsDisabled={utilityActionsDisabled}
                    onShowInfo={() => onShowDeckInfo(WOAH_DUDE_DECK.id)}
                    isDeckSet={true}
                    visualStyle={WOAH_DUDE_DECK.visualStyle}
                />
            </div>
        )}
        <div key="RANDOM" className={deckButtonContainerStyle}> 
            <ThemedDeckButton
                itemId="RANDOM" 
                itemName="Surprise Me!"
                colorClass="from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500"
                onDrawClick={() => onDraw("RANDOM")}
                drawActionDisabled={drawActionDisabled}
                utilityActionsDisabled={utilityActionsDisabled}
                isRandomButton={true}
            />
        </div>

        {categorizedDecks.map(({ category, decks }) => (
            <React.Fragment key={category.id}>
                <div className="flex-shrink-0 h-full w-10">
                    <ThemedDeckButton
                        itemId={`CATEGORY_${category.id}`}
                        itemName={category.name}
                        colorClass="from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700"
                        onDrawClick={() => onDraw(`CATEGORY_${category.id}`)}
                        drawActionDisabled={drawActionDisabled}
                        utilityActionsDisabled={utilityActionsDisabled}
                        isCategoryButton={true}
                    />
                </div>
                {decks.map(deck => {
                    const { colorClass } = getDisplayDataForCard(deck.id, customDecks);
                    return (
                        <div key={deck.id} className={deckButtonContainerStyle}> 
                            <ThemedDeckButton
                                itemId={deck.id}
                                itemName={deck.name}
                                colorClass={colorClass}
                                onDrawClick={() => onDraw(deck.id)}
                                drawActionDisabled={drawActionDisabled}
                                utilityActionsDisabled={utilityActionsDisabled}
                                onShowInfo={() => onShowDeckInfo(deck.id)}
                                isDeckSet={true}
                            />
                        </div>
                    );
                })}
            </React.Fragment>
        ))}

        {customDecks.length > 0 && (
            <React.Fragment>
                 <div className="flex-shrink-0 h-full flex items-center justify-center text-center font-bold text-slate-500 uppercase tracking-widest text-xs transform -rotate-90">
                   Custom
                </div>
                {customDecks.map(deck => (
                    <div key={deck.id} className={deckButtonContainerStyle}>
                        <ThemedDeckButton
                            itemId={deck.id}
                            itemName={deck.name}
                            colorClass={deck.colorClass}
                            onDrawClick={() => onDraw(deck.id)}
                            drawActionDisabled={drawActionDisabled}
                            utilityActionsDisabled={utilityActionsDisabled}
                            customDeckData={deck}
                            onEditCustomDeck={onEditCustomDeck}
                            onShowInfo={() => onShowDeckInfo(deck.id)}
                        />
                    </div>
                ))}
            </React.Fragment>
        )}
        
        <div className={`${deckButtonContainerStyle} flex items-center justify-center`}>
            <button
                onClick={onAddCustomDeck}
                disabled={drawActionDisabled} 
                className={`w-full h-full flex flex-col items-center justify-center bg-slate-700 rounded-lg border-2 border-dashed border-slate-500 text-slate-400 transition-all duration-200 p-2 focus:outline-none 
                            ${drawActionDisabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-600 hover:border-sky-400 hover:text-sky-300 focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-900'}`}
                aria-label="Add new custom deck"
                title="Add a new custom deck"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-1/3 w-1/3 max-h-10 max-w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-xs sm:text-sm font-semibold mt-1 text-center">Add Deck</span>
            </button>
        </div>
      </div>
    </div>
  );
};
