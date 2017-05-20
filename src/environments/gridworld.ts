import { Gridworld } from './gridworld';
import { BaseEnvironment } from './environment';
import { Util } from '../util/util';
import { Action, Reward, Observation, Percept } from '../util/x';
import { ExplorationPlot } from '../vis/plot';
import { Model } from '../models/model';

enum REWARDS {
	chocolate 	= 100,
	wall 		= -5,
	empty 		= 0,
	move 		= -1,
};

const MAPSYMBOLS = {
	empty		: "F",
	chocolate	: 'C',
	wall 		: 'W',
	dispenser 	: 'D',
	trap 		: 'T',
	modifier 	: 'M',
};

const ACTIONS = [
	[-1, 0], 	// left
	[1, 0], 	// right
	[0, -1], 	// up
	[0, 1], 	// down
	[0, 0], 	// noop
];

interface saved {
	x: 		number;
	y: 		number;
	reward: Reward;
}

export class Gridworld extends BaseEnvironment {
	obsBits: 				number;
	grid: 					Tile[][];
	N: 						number;
	actions: 				any[];
	numActions: 			Action;
	minReward:				Reward;
	maxReward:				Reward;

	explored: 				number = 0;
	statePercepts: 			boolean = false;
	wallHit: 				boolean = false;

	protected state: 		Tile;
	protected savedState: 	saved;
	protected goals: 		Tile[];

	static defaults = { // TODO: static members necessary?
		N: 10,
		goals: {
			theta: 0.75,
		},
	};

	constructor(options) {
		super(options);
		if (!options.randomized) {
			options.randomized = true;
			return Gridworld.generateRandom(this.constructor, options);
		}

		this.plots = [ExplorationPlot];
		this.obsBits = 4;
		this.grid = [];
		this.N = options.N;
		this.savedState = {
			x: 0,
			y: 0,
			reward: 0,
		};
		this.numActions = this.actions.length;
		this.reward = -1; // TODO: "fix name conflict" (?)
		this.noop = 4;
		this.statePercepts = options.statePercepts

		this.minReward = REWARDS.wall + REWARDS.move;
		this.maxReward = REWARDS.chocolate + REWARDS.move;

		for (let i = 0; i < this.N; i++) {
			this.grid[i] = new Array(this.N);
			for (let j = 0; j < this.N; j++) {
				this.grid[i][j] = Gridworld.newTile(i, j, options, options.map[j][i]);
			}
		}

		if (options.goals) { // TODO: check: will options.goals ever *not* exist?
			this.goals = [];
			for (let goal of options.goals) {
				let type = goal.type || MAPSYMBOLS.dispenser;
				let g = Gridworld.newTile(goal.x, goal.y, goal.theta, type);
				g.goal = true;
				this.grid[goal.x][goal.y] = g;
				this.goals.push(g);
			}
		}

		this.generateConnexions();

		if (options.initial) {
			this.state = this.grid[options.initial.x][options.initial.y];
		} else {
			this.state = this.grid[0][0];
		}
	}

	generateConnexions() {
		let grid = this.grid;
		let actions = this.actions;
		grid.forEach((row, idx) => {
			row.forEach((tile, jdx) => {
				let str = '';
				for (let a = 0; a < this.numActions; a++) {
					let i = actions[a][0];
					let j = actions[a][1];
					if (!grid[idx + i] ||
						!grid[idx + i][jdx + j] ||
						grid[idx + i][jdx + j].constructor == Wall) {
						str += '1';
					} else {
						if (i || j) {
							str += '0';
						}

						if (tile.constructor != Trap && tile.constructor != Wall) {
							tile.connexions[a] = grid[idx + i][jdx + j];
						}

					}
				}
				if (this.statePercepts) {
					tile.obs = idx * this.N + jdx;
				} else {
					tile.obs = parseInt(str, 2);
				}

			});
		});
	}

	isSolvable() {
		let queue = [];
		let state = 0;

		let maxFreq = 0;
		for (let goal of this.options.goals) {
			if (goal.theta > maxFreq) {
				maxFreq = goal.theta;
			}
		}

		for (let i = 0; i < this.N; i++) {
			for (let j = 0; j < this.N; j++) {
				this.grid[i][j].expanded = false;
			}
		}

		this.numStates = 1;
		queue.push(this.grid[0][0]);
		let solvable = false;
		while (state < queue.length) {
			let ptr = queue[state];
			ptr.expanded = true;
			for (let t of ptr.connexions) {
				if (!t || t.expanded) {
					continue;
				}

				this.numStates++;
				if ((t.constructor == Dispenser && t.theta == maxFreq) || t.constructor == Chocolate) {
					solvable = true;
				}

				t.expanded = true;
				queue.push(t);
			}

			state++;
		}

		return solvable;
	}

	perform(action: Action) {
		var rew = REWARDS.move;
		var t = this.state.connexions[action];

		if (t) {
			rew += t.reward();
			if (!t.visited) {
				t.visited = true;
				this.explored++;
			}

			this.state = t;
			this.wallHit = false;
		} else {
			rew += REWARDS.wall;
			this.wallHit = true;
		}

		this.state.dynamics();
		this.reward = rew;
	}

	generatePercept() {
		return {
			obs: this.state.obs,
			rew: this.reward,
		};
	}

	save() {
		this.savedState = {
			x: this.state.x,
			y: this.state.y,
			reward: this.reward,
		};
	}

	load() {
		Util.assert(this.savedState, 'No saved state to load!');
		this.state = this.grid[this.savedState.x][this.savedState.y];
		this.reward = this.savedState.reward;
	}

	copy() {
		let res = new this.constructor(this.options);
		res.state = res.grid[this.state.x][this.state.y];
		res.reward = this.reward;

		return res;
	}

	getState() {
		return { x: this.state.x, y: this.state.y };
	}

	makeModel(model, parametrization) {
		if (model == QTable) {
			return new QTable(100, this.numActions); // TODO: magic no.
		}

		if (model == DirichletGrid) {
			return new DirichletGrid(this.options.N);
		}

		var modelClass:Model[] = [];
		var modelWeights = [];
		let options = Util.deepCopy(this.options);

		if (parametrization == 'mu') {
			modelClass.push(new this.constructor(options));
			modelWeights = [1]
		} else if (parametrization == 'maze') {
			options.randomized = false;
			for (let n = 4; n < this.N; n++) {
				options.N = n;
				for (let k = 0; k < n; k++) {
					modelClass.push(Gridworld.generateRandom(this.constructor, options));
					modelWeights.push(1);
				}
			}

			modelClass.push(new this.constructor(this.options));
			modelWeights.push(1);
		} else {
			let C = options.N**2;
			for (let i = 0; i < options.N; i++) {
				for (let j = 0; j < options.N; j++) {
					if (parametrization == 'goal') {
						options.goals = [
							{
								x: j,
								y: i,
								theta: options.goals[0].theta,
							},
						];
					} else if (parametrization == 'state') {
						options.initial = { x: j, y: i };
					}

					let t = this.grid[j][i];
					if (t.constructor == Wall || !t.expanded) {
						modelWeights.push(0);
					} else {
						modelWeights.push(1);
					}

					let m = new this.constructor(options);
					modelClass.push(m);
				}
			}
		}

		// ensure prior is normalised
		let C = modelWeights.length;
		let s = Util.sum(modelWeights);
		let weights = new Float32Array(C);
		for (let i = 0; i < C; i++) {
			weights[i] = modelWeights[i] / s;
		}

		return new BayesMixture(modelClass, weights);
	}

	conditionalDistribution(e) {
		let p = this.generatePercept();
		let s = this.state;
		if (s.constructor == NoiseTile) {
			return e.rew == p.rew ? s.prob : 0;
		}

		if (e.obs != p.obs) {
			// observations are deterministic
			return 0;
		} else if (!s.goal) {
			// all tiles except the goal are deterministic
			return e.rew == p.rew ? 1 : 0;
		} else {
			let rew = e.rew - REWARDS.move;
			if (rew == REWARDS.chocolate) {
				return s.theta;
			} else if (rew == REWARDS.empty) {
				return 1 - s.theta;
			} else {
				return rew == REWARDS.wall && this.wallHit;
			}
		}
	}


	static generateRandom(constructor: (o: any) => any, options: any): Gridworld {
		let opt = Gridworld.proposeRandom(options);
		let env: Gridworld = new constructor(opt);
		if (!env.isSolvable()) {
			return Gridworld.generateRandom(constructor, options);
		}

		return env;

	}

	static proposeRandom(options) {
		let opt = Util.deepCopy(options);
		let N = options.N;
		let trapProb = options.trapProb || 0;
		let wallProb = options.wallProb || 0.4;
		opt.map = [];
		for (let i = 0; i < N; i++) {
			opt.map[i] = new Array(N);
			for (let j = 0; j < N; j++) {
				if (i == 0 && j == 0) {
					opt.map[i][j] = MAPSYMBOLS.empty;
				}

				let r = Math.random();
				if (r < trapProb) {
					opt.map[i][j] = MAPSYMBOLS.trap;
				} else if (r < wallProb) {
					opt.map[i][j] = MAPSYMBOLS.wall;
				} else {
					opt.map[i][j] = MAPSYMBOLS.empty;
				}
			}
		}

		for (let goal of opt.goals) {
			let g = Gridworld.proposeGoal(N);
			goal.x = g.x;
			goal.y = g.y;
			opt.map[g.y][g.x] = MAPSYMBOLS.empty;
		}

		return opt;
	}

	static proposeGoal(N: number): any {
		let gx = Util.randi(0, N);
		let gy = Util.randi(0, N);
		if (gx + gy < N / 2) {
			return Gridworld.proposeGoal(N);
		}

		return {
			x: gx,
			y: gy,
		};

	}

	static newTile(i, j, info, type) {
		let tile:Tile = null;
		if (type == MAPSYMBOLS.empty) {
			tile = new Tile(i, j);
		} else if (type == MAPSYMBOLS.wall) {
			tile = new Wall(i, j);
		} else if (type == MAPSYMBOLS.chocolate) {
			tile = new Chocolate(i, j);
		} else if (type == MAPSYMBOLS.dispenser) {
			tile = new Dispenser(i, j, info);
		} else if (type == MAPSYMBOLS.trap) {
			tile = new Trap(i, j);
		} else if (type == MAPSYMBOLS.modifier) {
			tile = new SelfModificationTile(i, j);
		} else {
			throw `Error: unknown Tile type: ${type}.`;
		}

		return tile;
	}
}

class WireheadingGrid extends Gridworld {
	wireheaded: boolean;
	savedGeneratePercept: () => Percept;
	savedConditionalDistribution: (e: Percept) => number;
	dynamics(tile: Tile) {
		if (tile.constructor == SelfModificationTile) {
			this.conditionalDistribution = e => {
				let p = this.generatePercept();
				return p.rew == e.rew;
			};

			this.generatePercept = () => {
				let p = super.generatePercept();
				p.rew = Number.MAX_VALUE;
				return p;
			};

			this.wireheaded = true;
		}

		return 0;
	}

	getState() {
		let s = super.getState();
		s['wireheaded'] = this.wireheaded;

		return s;
	}

	save() {
		super.save();
		this.savedConditionalDistribution = this.conditionalDistribution;
		this.savedGeneratePercept = this.generatePercept;
	}

	load() {
		super.load();
		this.conditionalDistribution = this.savedConditionalDistribution;
		this.generatePercept = this.savedGeneratePercept;
	}
}

class EpisodicGrid extends Gridworld {
	conditionalDistribution(e: Percept) {
		let p = this.generatePercept();
		return (e.obs == p.obs && e.rew == p.rew) ? 1 : 0;
	}

	dynamics(tile: Tile) {
		if (tile.constructor == Chocolate) { // TODO: fix
			this.state = this.grid[0][0];
		}

		return 0;
	}
}

class Tile {
	x: 			number;
	y: 			number;
	legal: 		boolean;
	connexions: Tile[];
	symbol: 	number = 0;
	obs: 		Observation;

	dynamics: 	() => void;
	reward: 	() => Reward;
	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
		this.reward = () =>  REWARDS.empty;

		this.legal = true;
		this.obs = null; // gets filled out on construction
		this.connexions = new Array();
		this.dynamics = () => null;
	}
}

function isWall(x: Tile): x is Wall {
	return !x.legal;
}

class Wall extends Tile {
	constructor(x: number, y: number) {
		super(x, y);
		this.reward = () => REWARDS.wall;
		this.legal = false;
		this.symbol = 1;
	}
}

class Dispenser extends Tile {
	theta: number; 
	constructor(x: number, y: number, theta: number) {
		super(x, y);
		this.theta = theta;
		this.reward = function () {
			return Math.random() < this.theta ? REWARDS.chocolate : REWARDS.empty;
		};
	}
}

class Trap extends Tile {
	constructor(x: number, y: number) {
		super(x, y);
		this.reward =  () => REWARDS.wall;
	}
}

class SelfModificationTile extends Tile {
	constructor(x: number, y: number) {
		super(x, y);
	}
}

class NoiseTile extends Tile {
	numObs: number;
	constructor(x: number, y: number) {
		super(x, y);
		this.numObs = Math.pow(2, 2); // TODO: fix magic number
		this.dynamics = function () {
			this.obs = Util.randi(0, this.numObs);
		};
	}
}
