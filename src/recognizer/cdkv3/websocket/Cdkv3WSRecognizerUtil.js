import { recognizerLogger as logger } from '../../../configuration/LoggerConfig';
import * as NetworkWSInterface from '../../networkHelper/websocket/networkWSInterface';
import * as Cdkv3WSWebsocketBuilder from './Cdkv3WSBuilder';
import * as PromiseHelper from '../../../util/PromiseHelper';
import * as InkModel from '../../../model/InkModel';
import * as StrokeComponent from '../../../model/StrokeComponent';
import { updateRecognizerPositions, resetRecognizerPositions } from '../common/Cdkv3CommonResetBehavior';
import MyScriptJSConstants from '../../../configuration/MyScriptJSConstants';

/**
 * Get the authorized triggers
 * @return {Array<String>} Available recognition triggers
 */
export function getAvailableRecognitionTriggers() {
  return [MyScriptJSConstants.RecognitionTrigger.PEN_UP];
}

function buildUrl(options, suffixUrl) {
  const scheme = (options.recognitionParams.server.scheme === 'https') ? 'wss' : 'ws';
  return scheme + '://' + options.recognitionParams.server.host + suffixUrl;
}

function send(recognizerContext, recognitionContext) {
  const recognizerContextReference = recognizerContext;
  const recognitionContextReference = recognitionContext;

  logger.debug('Recognizer is alive. Sending last stroke');
  recognizerContextReference.recognitionContexts.push(recognitionContextReference);

  if (recognizerContextReference.lastRecognitionPositions.lastSentPosition < 0) {
    // In websocket the last stroke is getLastPendingStrokeAsJsonArray as soon as possible to the server.
    const strokes = recognitionContextReference.model.rawStrokes.map(stroke => StrokeComponent.toJSON(stroke));
    recognizerContextReference.lastRecognitionPositions.lastSentPosition = strokes.length - 1;
    NetworkWSInterface.send(recognizerContextReference.websocket, recognitionContextReference.buildStartInputFunction(recognitionContextReference.options, strokes));
  } else {
    recognizerContextReference.lastRecognitionPositions.lastSentPosition++;
    // In websocket the last stroke is getLastPendingStrokeAsJsonArray as soon as possible to the server.
    updateRecognizerPositions(recognizerContextReference, recognitionContextReference.model);
    const strokes = InkModel.extractPendingStrokes(recognitionContextReference.model, -1).map(stroke => StrokeComponent.toJSON(stroke));
    NetworkWSInterface.send(recognizerContextReference.websocket, recognitionContextReference.buildContinueInputFunction(strokes));
  }
}

/**
 * Init the websocket recognizer.
 * Open the connexion and proceed to the hmac challenge.
 * A recognizer context is build as such :
 * @param {String} suffixUrl
 * @param {Options} options
 * @param {RecognizerContext} recognizerContext
 * @return {Promise} Fulfilled when the init phase is over.
 */
export function init(suffixUrl, options, recognizerContext) {
  const recognizerContextReference = recognizerContext;
  const url = buildUrl(options, suffixUrl);
  const destructuredInitPromise = PromiseHelper.destructurePromise();

  logger.debug('Opening the websocket for context ', recognizerContextReference);
  const initCallback = Cdkv3WSWebsocketBuilder.buildWebSocketCallback(destructuredInitPromise, recognizerContextReference, options);
  recognizerContextReference.websocket = NetworkWSInterface.openWebSocket(url, initCallback);
  recognizerContextReference.recognitionContexts = [];

  // Feeding the recognitionContext
  recognizerContextReference.initPromise = destructuredInitPromise.promise;

  destructuredInitPromise.promise.then(
      (value) => {
        logger.debug('Init over ' + value);
      }
  ).catch(
      (error) => {
        logger.error('fatal error while loading recognizer');
      }
  );
  return recognizerContextReference.initPromise;
}

/**
 * Do what is needed to clean the server context.
 * @param {Options} options Current configuration
 * @param {Model} model Current model
 * @param {RecognizerContext} recognizerContext Current recognition context
 * @return {Promise}
 */
export function reset(options, model, recognizerContext) {
  const recognizerContextReference = recognizerContext;
  resetRecognizerPositions(recognizerContext, model);
  if (recognizerContextReference && recognizerContextReference.websocket) {
    // We have to send again all strokes after a reset.
    delete recognizerContextReference.instanceId;
    NetworkWSInterface.send(recognizerContextReference.websocket, { type: 'reset' });
  }
  // We do not keep track of the success of reset.
  return Promise.resolve();
}

/**
 * @param {Options} options
 * @param {RecognizerContext} recognizerContext
 * @param {Model} model
 * @param {function(parameters: Options, components: Array)} buildStartInputFunction
 * @param {function(components: Array)} buildContinueInputFunction
 * @param {function(model: Model, recognitionData: Object)} processResultFunction
 * @return {Promise}
 */
export function recognize(options, recognizerContext, model, buildStartInputFunction, buildContinueInputFunction, processResultFunction) {
  const destructuredRecognitionPromise = PromiseHelper.destructurePromise();
  const recognizerContextReference = recognizerContext;
  if (!recognizerContextReference.awaitingRecognitions) {
    recognizerContextReference.awaitingRecognitions = [];
  }
  // Building an object with all mandatory fields to feed the recognition queue.
  const recognitionContext = {
    buildStartInputFunction,
    buildContinueInputFunction,
    processResultFunction,
    model,
    options,
    recognitionPromiseCallbacks: destructuredRecognitionPromise
  };

  recognizerContextReference.initPromise.then(() => {
    logger.debug('Init was done feeding the recognition queue');
    send(recognizerContextReference, recognitionContext);
  });

  return destructuredRecognitionPromise.promise;
}

/**
 * Close and free all resources that will no longer be used by the recognizer.
 * @param {Options} options
 * @param {Model} model
 * @param {RecognizerContext} recognizerContext
 * @return {Promise}
 */
export function close(options, model, recognizerContext) {
  if (recognizerContext && recognizerContext.websocket) {
    NetworkWSInterface.close(recognizerContext.websocket, 1000, 'CLOSE BY USER');
  }
}

