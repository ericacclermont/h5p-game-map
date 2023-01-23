import Dictionary from '@services/dictionary';
import Jukebox from '@services/jukebox';
import Util from '@services/util';
import Globals from '@services/globals';
import Paths from '@models/paths';
import Stages from '@models/stages';
import StartScreen from './media-screen/start-screen';
import EndScreen from './media-screen/end-screen';
import Map from '@components/map/map';
import Toolbar from '@components/toolbar/toolbar';
import Exercises from '@models/exercises';
import ExerciseScreen from '@components/exercise/exercise-screen';
import ConfirmationDialog from '@components/confirmation-dialog/confirmation-dialog';
import './content.scss';

export default class Content {

  /**
   * @class
   * @param {object} [params={}] Parameters.
   * @param {object} [callbacks={}] Callbacks.
   * @param {function} [callbacks.onProgressChanged] Called on progress change.
   * @param {function} [callbacks.onFinished] Called when finished.
   */
  constructor(params = {}, callbacks = {}) {
    this.params = Util.extend({
    }, params);

    this.callbacks = Util.extend({
      onProgressChanged: () => {},
      onFinished: () => {}
    }, callbacks);

    Globals.set('getScore', () => {
      return this.getScore();
    });

    this.buildDOM();

    this.reset({ isInitial: true });

    if (this.getMaxScore() > 0) {
      this.toolbar.showScores();
    }

    this.start({ isInitial: true });

    // Reattach H5P.Question buttons and scorebar to endscreen
    H5P.externalDispatcher.on('initialized', () => {
      const feedbackWrapper = this.grabH5PQuestionFeedback({
        maxScore: this.getMaxScore()
      });

      this.endScreen.setContent(feedbackWrapper);

      this.handleAutoplay();
    });
  }

  /**
   * Grab H5P.Question feedback and scorebar.
   * H5P.Question already handles scores nicely, no need to recreate all that.
   * Issue here: We can relocate the DOMs for feedback and scorbar, but those
   * are created after setting feedback the first time only. It's also
   * required to set the maximum score now. Cannot be changed later.
   *
   * @param {object} [params={}] Parameters.
   * @param {number} [params.maxScore] Maximum score possible.
   * @returns {HTMLElement|null} Wrapper with H5P.Question feedback.
   */
  grabH5PQuestionFeedback(params = {}) {
    const content = this.dom.closest('.h5p-question-content');
    if (!content) {
      return null;
    }

    const container = content.parentNode;
    if (!container) {
      return null;
    }

    const main = Globals.get('mainInstance');
    main.setFeedback('', 0, params.maxScore);

    const feedbackWrapper = document.createElement('div');
    feedbackWrapper.classList.add('h5p-game-map-feedback-wrapper');

    const feedback = container.querySelector('.h5p-question-feedback');
    if (feedback) {
      feedbackWrapper.append(feedback.parentNode.removeChild(feedback));
    }

    const scorebar = container.querySelector('.h5p-question-scorebar');
    if (scorebar) {
      feedbackWrapper.append(scorebar.parentNode.removeChild(scorebar));
    }

    main.removeFeedback();

    return feedbackWrapper;
  }

  /**
   * Build the DOM.
   */
  buildDOM() {
    this.dom = document.createElement('div');
    this.dom.classList.add('h5p-game-map-container');

    const globalParams = Globals.get('params');

    // Title screen if set
    if (globalParams.showTitleScreen) {
      this.startScreen = new StartScreen({
        id: 'start',
        contentId: Globals.get('contentId'),
        introduction: globalParams.titleScreen.titleScreenIntroduction,
        medium: globalParams.titleScreen.titleScreenMedium,
        buttons: [
          { id: 'start', text: Dictionary.get('l10n.start') }
        ],
        a11y: {
          screenOpened: Dictionary.get('a11y.startScreenWasOpened')
        }
      }, {
        onButtonClicked: () => {
          this.show({ focusButton: true, readOpened: true });
        },
        read: (text) => {
          Globals.get('read')(text);
        }
      });
      this.startScreen.hide();
      this.dom.append(this.startScreen.getDOM());
    }

    const endscreenButtons = [];
    if (globalParams.behaviour.enableSolutionsButton) {
      endscreenButtons.push(
        { id: 'show-solutions', text: Dictionary.get('l10n.showSolutions') }
      );
    }
    if (globalParams.behaviour.enableRetry) {
      endscreenButtons.push(
        { id: 'restart', text: Dictionary.get('l10n.restart') }
      );
    }

    // End screen
    this.endScreen = new EndScreen({
      id: 'end',
      contentId: Globals.get('contentId'),
      buttons: endscreenButtons,
      a11y: {
        screenOpened: Dictionary.get('a11y.endScreenWasOpened')
      }
    }, {
      onButtonClicked: (id) => {
        if (id === 'restart') {
          this.reset();
          this.start();
        }
        else if (id === 'show-solutions') {
          this.showSolutions();

          Globals.get('read')(Dictionary.get('a11y.mapSolutionsWasOpened'));
          window.setTimeout(() => {
            this.toolbar.focus();
          }, 100);
        }
      },
      read: (text) => {
        Globals.get('read')(text);
      }
    });
    this.endScreen.hide();
    this.dom.append(this.endScreen.getDOM());

    // Content incl. tool/statusbar and map
    this.contentDOM = document.createElement('div');
    this.contentDOM.classList.add('h5p-game-map-content');
    this.dom.append(this.contentDOM);

    const toolbarButtons = [];

    if (Jukebox.getAudioIds().length) {
      toolbarButtons.push({
        id: 'audio',
        type: 'toggle',
        a11y: {
          active: Dictionary.get('a11y.buttonAudioActive'),
          inactive: Dictionary.get('a11y.buttonAudioInactive')
        },
        onClick: (ignore, params) => {
          this.toggleAudio(params.active);
        }
      });
    }

    toolbarButtons.push({
      id: 'finish',
      type: 'pulse',
      a11y: {
        active: Dictionary.get('a11y.buttonFinish')
      },
      onClick: () => {
        this.handleFinish();
      }
    });

    // Toolbar
    this.toolbar = new Toolbar({
      ...(globalParams.headline && {headline: globalParams.headline}),
      buttons: toolbarButtons
    });
    this.contentDOM.append(this.toolbar.getDOM());

    // Map incl. models
    const backgroundImage = H5P.getPath(
      globalParams?.gamemapSteps?.backgroundImageSettings?.backgroundImage
        ?.path ?? '',
      Globals.get('contentId')
    );

    // Stages
    this.stages = new Stages(
      {
        elements: globalParams.gamemapSteps.gamemap.elements,
        visuals: globalParams.visual.stages,
        hidden: globalParams.behaviour.map.fog !== 'all'
      },
      {
        onStageClicked: (id, state) => {
          this.handleStageClicked(id, state);
        },
        onStageStateChanged: (id, state) => {
          this.handleStageStateChanged(id, state);
        },
        onFocussed: () => {
          this.handleStageFocussed();
        },
        onBecameActiveDescendant: (id) => {
          this.map?.setActiveDescendant(id);
        },
        onAddedToQueue: (callback, params) => {
          this.addToQueue(callback, params);
        }
      }
    );

    // Paths
    const pathsHidden = (globalParams.behaviour.map.displayPaths === false) ||
      globalParams.behaviour.map.fog !== 'all';

    this.paths = new Paths(
      {
        elements: globalParams.gamemapSteps.gamemap.elements,
        visuals: globalParams.visual.paths,
        hiddenInitially: pathsHidden
      }
    );

    // Map
    this.map = new Map(
      {
        backgroundImage: backgroundImage,
        paths: this.paths,
        stages: this.stages
      },
      {
        onImageLoaded: () => {
          // Resize when image is loaded
          Globals.get('resize')();

          // Resize when image resize is done
          window.requestAnimationFrame(() => {
            Globals.get('resize')();
          });
        }
      }
    );
    this.contentDOM.append(this.map.getDOM());

    // Exercise
    this.exercises = new Exercises(
      {
        elements: globalParams.gamemapSteps.gamemap.elements
      },
      {
        onStateChanged: (id, state) => {
          this.handleExerciseStateChanged(id, state);
        },
        onScoreChanged: (id, state) => {
          this.handleExerciseScoreChanged(id, state);
        }
      }
    );

    this.exerciseScreen = new ExerciseScreen({}, {
      onClosed: () => {
        this.handleExerciseClosed();
      },
      onOpenAnimationEnded: () => {
        Globals.get('resize')();
      },
      onCloseAnimationEnded: () => {
        this.playAnimationQueue();
      }
    });
    this.exerciseScreen.hide();
    this.dom.append(this.exerciseScreen.getDOM());

    // Confirmation Dialog
    this.confirmationDialog = new ConfirmationDialog();
    document.body.append(this.confirmationDialog.getDOM());
  }

  /**
   * Get DOM.
   *
   * @returns {HTMLElement} Content DOM.
   */
  getDOM() {
    return this.dom;
  }

  /**
   * Show.
   *
   * @param {object} params Parameters.
   * @param {boolean} [params.focusButton] If true, start button will get focus.
   * @param {boolean} [params.readOpened] If true, announce screen was opened.
   */
  show(params = {}) {
    this.map.show();
    this.contentDOM.classList.remove('display-none');

    if (params.readOpened) {
      Globals.get('read')(Dictionary.get('a11y.mapWasOpened'));
    }

    window.setTimeout(() => {
      if (params.focusButton) {
        this.toolbar.focus();
      }
    }, 100);

    // Initially, two resizes are required
    window.requestAnimationFrame(() => {
      Globals.get('resize')();

      window.requestAnimationFrame(() => {
        Globals.get('resize')();
      });
    });
  }

  /**
   * Hide.
   */
  hide() {
    this.map.hide();
    this.contentDOM.classList.add('display-none');
  }

  /**
   * Resize.
   */
  resize() {
    const mapSize = this.map.getSize();
    if (!mapSize || mapSize.width === 0 || mapSize.height === 0) {
      return;
    }

    const paramsMisc = Globals.get('params').visual.misc;
    if (paramsMisc.heightLimitMode === 'auto') {
      // Try to compute maximum visible height
      const displayLimits = Util.computeDisplayLimits(this.dom);
      if (!displayLimits?.height) {
        return;
      }

      this.limitMapHeight(displayLimits.height);
    }
    else if (
      paramsMisc.heightLimitMode === 'custom' &&
      typeof paramsMisc.heightLimit === 'number' &&
      paramsMisc.heightLimit > 200
    ) {
      this.limitMapHeight(paramsMisc.heightLimit);
    }

    this.map.resize();
    clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => {
      this.paths.update({ mapSize: this.map.getSize() });
    }, 0);

    /*
     * For some reason, the grid-areas of this.dom can overshoot the maximum
     * width of 100% and some content types will overflow. This solution is
     * not good, but I have not found a different one yet.
     */
    if (
      this.exerciseScreen.getSize().width >
      this.dom.getBoundingClientRect().width
    ) {
      clearTimeout(this.exersizeScreenResizeTimeout);
      this.exersizeScreenResizeTimeout = setTimeout(() => {
        Globals.get('resize')();
      }, 0);
    }
  }

  /**
   * Limit map height
   *
   * @param {number} maxHeight Maximum wanted height.
   */
  limitMapHeight(maxHeight) {
    // Reset to get intrinsic height
    this.map.setMaxHeight();

    // Height of content
    const contentHeight = this.contentDOM.getBoundingClientRect().height;

    // Margin around content
    const contentStyle = window.getComputedStyle(this.contentDOM);
    const contentMargin =
      parseFloat(contentStyle.getPropertyValue('margin-top')) +
      parseFloat(contentStyle.getPropertyValue('margin-bottom'));

    // Toolbar height
    const toolbarStyle = window.getComputedStyle(this.toolbar.getDOM());
    const toolbarHeight = this.toolbar.getDOM().getBoundingClientRect().height +
      parseFloat(toolbarStyle.getPropertyValue('margin-top')) +
      parseFloat(toolbarStyle.getPropertyValue('margin-bottom'));

    /*
     * If maximum set height for all display is not sufficient, limit map height
     */
    if (maxHeight - contentMargin < contentHeight) {
      this.map.setMaxHeight(
        maxHeight - contentMargin - toolbarHeight -
        Content.CONVENIENCE_MARGIN_PX
      );
    }
  }

  /**
   * Handle stage clicked.
   *
   * @param {string} id Id of stage that was clicked on.
   */
  handleStageClicked(id) {
    this.stages.disable();

    const stage = this.stages.getStage(id);
    const exercise = this.exercises.getExercise(id);

    this.exerciseScreen.setH5PContent(exercise.getDOM());
    this.exerciseScreen.setTitle(stage.getLabel());
    this.exerciseScreen.show();
    Jukebox.play('openExercise');

    if (!this.isShowingSolutions) {
      // Update context for confusion report contract
      const stageIndex = Globals.get('params').gamemapSteps.gamemap.elements
        .findIndex((element) => element.id === id);
      this.currentStageIndex = stageIndex + 1;
      this.callbacks.onProgressChanged(this.currentStageIndex);
    }

    // Store to restore focus when exercise screen is closed
    this.currentlyOpenStage = stage;

    this.isExerciseOpen = true;

    window.requestAnimationFrame(() => {
      Globals.get('resize')();
    });
  }

  /**
   * Handle exercise state changed.
   *
   * @param {string} id Id of exercise that was changed.
   * @param {number} state State code.
   */
  handleExerciseStateChanged(id, state) {
    if (this.isShowingSolutions) {
      return;
    }

    this.stages.updateState(id, state);
  }

  /**
   * Handle stage state changed.
   *
   * @param {string} id Id of exercise that was changed.
   * @param {number} state State code.
   */
  handleStageStateChanged(id, state) {
    if (this.isShowingSolutions) {
      return;
    }

    if (this.paths) {
      this.addToQueue(() => {
        this.paths.updateState(id, state);
      });
    }

    if (this.stages) {
      this.addToQueue(() => {
        this.stages.updateNeighborsState(id, state);
      });
    }
  }

  /**
   * Handle stage focussed.
   */
  handleStageFocussed() {
    window.setTimeout(() => {
      Globals.get('read')(Dictionary.get('a11y.applicationInstructions'));
    }, 250); // Make sure everything else is read already
  }

  /**
   * Get xAPI data from exercises.
   *
   * @returns {object[]} XAPI data objects used to build report.
   */
  getXAPIData() {
    return this.exercises.getXAPIData();
  }

  /**
   * Determine whether some answer was given.
   *
   * @returns {boolean} True, if some answer was given.
   */
  getAnswerGiven() {
    return this.exercises.getAnswerGiven();
  }

  /**
   * Get score.
   *
   * @returns {number} Score.
   */
  getScore() {
    return Math.min(
      this.exercises.getScore(),
      this.getMaxScore()
    );
  }

  /**
   * Get max score.
   *
   * @returns {number} Max score.
   */
  getMaxScore() {
    const maxScore = this.exercises.getMaxScore();
    const finishScore = Globals.get('params').behaviour.finishScore;

    return Math.min(finishScore, maxScore);
  }

  /**
   * Get context data.
   * Contract used for confusion report.
   *
   * @returns {object} Context data.
   */
  getContext() {
    return {
      type: 'stage',
      value: this.currentStageIndex
    };
  }

  /**
   * Add callback to animation queue.
   *
   * @param {function} callback Callback to execute.
   * @param {object} [params={}] Parameters.
   * @param {number} [params.delay = 0] Delay before calling callback.
   * @param {number} [params.block = 0] Delay before calling next callback.
   */
  addToQueue(callback, params = {}) {
    if (typeof callback !== 'function') {
      return;
    }

    params = Util.extend({
      delay: 0,
      block: 0
    }, params);

    if (!this.isExerciseOpen) {
      callback();
      return;
    }

    this.queueAnimation.push({ callback, params });
  }

  /**
   * Clear animation queue.
   */
  clearQueueAnimation() {
    // More animations might be added meanwhile
    const animationsToClear = [...this.scheduledAnimations];

    animationsToClear.forEach((animation) => {
      window.clearTimeout(animation);
      this.scheduledAnimations = this.scheduledAnimations.filter((anim) => {
        anim !== animation;
      });
    });
  }

  /**
   * Play animation queue.
   */
  playAnimationQueue() {
    // Compute absolute delay for each animation
    this.queueAnimation = this.queueAnimation.map((queueItem, index, all) => {
      if (index === 0) {
        return queueItem;
      }

      const previousParams = all[index - 1].params;
      queueItem.params.delay += previousParams.delay + previousParams.block;

      return queueItem;
    }, []);

    this.queueAnimation.forEach((queueItem) => {
      const scheduledAnimation = window.setTimeout(() => {
        queueItem.callback();
      }, queueItem.params.delay);

      this.scheduledAnimations.push(scheduledAnimation);
    });

    this.queueAnimation = [];
  }

  /**
   * Handle exercise score changed.
   */
  handleExerciseScoreChanged() {
    this.stages.updateUnlockingStages();

    if (!this.gameDone) {
      if (this.getScore() === this.getMaxScore()) {
        Jukebox.stopAll();
        Jukebox.play('fullScore');
        this.gameDone = true;
      }
    }

    this.toolbar.setScores({
      score: this.getScore(),
      maxScore: this.getMaxScore()
    });
  }

  /**
   * Handle exercise was closed.
   */
  handleExerciseClosed() {
    this.map.dom.setAttribute(
      'aria-label', Dictionary.get('a11y.applicationInstructions')
    );

    this.exerciseScreen.hide({ animate: true });
    Jukebox.play('closeExercise');
    this.stages.enable();

    this.currentlyOpenStage.focus({ skipNextFocusHandler: true });
    this.currentlyOpenStage = null;

    this.isExerciseOpen = false;
  }

  /**
   * Show end screen.
   *
   * @param {object} params Parameters.
   * @param {boolean} [params.focusButton] If true, start button will get focus.
   * @param {boolean} [params.readOpened] If true, announce screen was opened.
   */
  showEndscreen(params = {}) {
    const endscreenParams = Globals.get('params').endScreen;

    // Prepare end screen
    const score = this.getScore();
    const maxScore = this.getMaxScore();

    const textScore = H5P.Question.determineOverallFeedback(
      endscreenParams.overallFeedback, score / maxScore
    );

    // Output via H5P.Question - expects :num and :total
    const ariaMessage = Dictionary.get('a11y.yourResult')
      .replace('@score', ':num')
      .replace('@total', ':total');

    Globals.get('mainInstance').setFeedback(
      textScore,
      score,
      maxScore,
      ariaMessage
    );

    const defaultTitle = `<p style="text-align: center;">${Dictionary.get('l10n.completedMap')}</p>`;

    if (score === maxScore) {
      const success = endscreenParams.success;
      this.endScreen.setMedium(success.endScreenMediumSuccess);

      const html = Util.isHTMLWidgetFilled(success.endScreenTextSuccess) ?
        success.endScreenTextSuccess :
        defaultTitle;

      this.endScreen.setIntroduction(html);
    }
    else {
      const noSuccess = endscreenParams.noSuccess;
      this.endScreen.setMedium(noSuccess.endScreenMediumNoSuccess);

      const html = Util.isHTMLWidgetFilled(noSuccess.endScreenTextNoSuccess) ?
        noSuccess.endScreenTextNoSuccess :
        defaultTitle;

      this.endScreen.setIntroduction(html);
    }

    this.hide();
    this.endScreen.show(params);
  }

  /**
   * Toggle audio.
   *
   * @param {boolean} [state] State to set audio to.
   */
  toggleAudio(state) {
    this.isAudioOn = (typeof state === 'boolean') ? state : !this.isAudioOn;

    if (!this.isAudioOn) {
      Jukebox.mute();
    }
    else {
      Jukebox.unmute();
      Jukebox('backgroundMusic');
    }
  }

  /**
   * Handle autoplay of audio.
   */
  async handleAutoplay() {
    const backgroundMusic = Globals.get('params').audio.backgroundMusic;

    if (
      backgroundMusic.autoplay &&
      Jukebox.getAudioIds().includes('backgroundMusic')
    ) {
      let couldPlay = false;

      try {
        couldPlay = await Jukebox('backgroundMusic');
      }
      catch (error) {
        // Intentionally left blank
      }

      this.toolbar.forceButton('audio', couldPlay);
    }
    else {
      this.toolbar.forceButton('audio', true);
    }
  }

  /**
   * Handle finish.
   */
  handleFinish() {
    // In solution mode, no dialog and no xAPI necessary
    if (this.isShowingSolutions) {
      this.showEndscreen({ focusButton: true, readOpened: true });
      return;
    }

    const extras = Globals.get('extras');
    extras.isScoringEnabled = true;
    const isScoringEnabled = extras.standalone &&
      (extras.isScoringEnabled || extras.isReportingEnabled);

    const dialogTexts = [Dictionary.get('l10n.confirmFinishDialog')];
    if (isScoringEnabled) {
      dialogTexts.push(Dictionary.get('l10n.confirmFinishDialogSubmission'));
    }
    dialogTexts.push(Dictionary.get('l10n.confirmFinishDialogQuestion'));

    this.confirmationDialog.update(
      {
        headerText: Dictionary.get('l10n.confirmFinishHeader'),
        dialogText: dialogTexts.join(' '),
        cancelText: Dictionary.get('l10n.no'),
        confirmText: Dictionary.get('l10n.yes')
      }, {
        onConfirmed: () => {
          this.callbacks.onFinished();
          this.showEndscreen({ focusButton: true });
        }
      }
    );

    this.confirmationDialog.show();
    Jukebox.play('showDialog');
  }

  /**
   * Show solutions.
   */
  showSolutions() {
    this.confirmationDialog.hide();
    this.endScreen.hide();
    this.show();

    this.exercises.showSolutions();

    this.isShowingSolutions = true;
    this.toolbar.toggleSolutionMode(true);
  }

  /**
   * Reset.
   *
   * @param {object} [params={}] Parameters.
   * @param {boolean} [params.isInitial] If true, don't overwrite presets.
   */
  reset(params = {}) {
    Jukebox.mute();

    const globalParams = Globals.get('params');

    this.gameDone = false;

    this.currentStageIndex = 0;
    this.confirmationDialog.hide();

    this.isExerciseOpen = false;
    this.queueAnimation = [];
    this.scheduledAnimations = [];

    if (!params.isInitial) {
      this.isShowingSolutions = false;
    }

    this.toolbar.toggleSolutionMode(false);

    this.paths.reset({ isInitial: params.isInitial });
    this.stages.reset({ isInitial: params.isInitial });
    this.exercises.reset({ isInitial: params.isInitial });

    // Set start state stages
    if (globalParams.behaviour.map.roaming === 'free') {
      this.stages.forEach((stage) => {
        stage.setState('open');
      });
      this.paths.forEach((path) => {
        path.show();
      });
    }

    this.stages.setStartStages();

    // Initialize scores
    this.toolbar.setScores({
      score: this.getScore(),
      maxScore: this.getMaxScore()
    });

    // When *re*starting the map, keep audio on/off as set by user.
    this.isAudioOn = this.isAudioOn ?? false;

    if (this.isAudioOn) {
      Jukebox.unmute();
    }
  }

  /**
   * Start.
   *
   * @param {object} [params={}] Parameters.
   * @param {boolean} [params.isInitial] If true, don't overwrite presets.
   */
  start(params = {}) {
    this.endScreen.hide();

    const hasTitleScreen = Globals.get('params').showTitleScreen;

    if (hasTitleScreen) {
      this.hide();

      const startParams = !params.isInitial ?
        { focusButton: true, readOpened: true } :
        {};

      this.startScreen.show(startParams);
    }
    else if (!params.isInitial) {
      this.show({ focusButton: true, readOpened: true });
    }
    else {
      this.show();
    }

    Globals.get('resize')();
  }

  /**
   * Get current state.
   *
   * @returns {object} Current state to be retrieved later.
   */
  getCurrentState() {
    return {
      exercises: this.exercises.getCurrentState(),
      stages: this.stages.getCurrentState(),
      paths: this.paths.getCurrentState()
    };
  }
}

/** @constant {number} CONVENIENCE_MARGIN_PX Extra margin for height limit */
Content.CONVENIENCE_MARGIN_PX = 32;
