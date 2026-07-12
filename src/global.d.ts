export {};

declare global {
  interface HTMLElement {
    // Cycle de vie
    __quizDestroy?: () => void;
    __quizTextQuestionCleanup?: () => void;
    // Track / animation (engine/track.ts)
    __quizTransitionEndHandler?: (e: TransitionEvent) => void;
    __quizTargetX?: number;
    __quizTargetIndex?: number;
    __quizTargetHeight?: number;
    __quizLockedHeight?: number;
    // Nav tabs (engine/state.ts)
    __quizPressClearTimer?: number;
    // Viewport (engine/viewport.ts)
    __quizAppliedWidth?: number;
  }
}
