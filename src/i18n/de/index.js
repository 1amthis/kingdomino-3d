// Each part of the game keeps its own texts.
import ui from './ui.js';
import game from './game.js';
import coach from './coach.js';
import history from './history.js';
import guide from './guide.js';

export default { ...ui, ...game, ...coach, ...history, ...guide };
