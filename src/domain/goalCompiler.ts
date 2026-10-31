/**
 * Goal Compiler — deterministic fallback.
 *
 * Turns a natural-language goal into an editable plan of milestones → projects →
 * tasks using recognisable goal archetypes. It never pretends to be a model: plans
 * produced here are labelled `source: "template"` throughout the app.
 */

import { addDays, daysBetween, isValidDateKey } from "./time";
import type { DateKey, Energy, Minutes, PlanSource, Priority } from "./types";

export interface GoalRequest {
  text: string;
  /** Optional target date for the whole goal. */
  targetDate: DateKey | null;
  /** Hours per week the user can realistically spend (used for pacing). */
  hoursPerWeek: number;
  today: DateKey;
}

export interface CompiledTask {
  title: string;
  notes: string;
  priority: Priority;
  estimateMin: Minutes;
  energy: Energy | null;
  deadline: DateKey | null;
}

export interface CompiledProject {
  title: string;
  tasks: CompiledTask[];
}

export interface CompiledMilestone {
  title: string;
  description: string;
  deadline: DateKey | null;
  projects: CompiledProject[];
}

export interface CompiledPlan {
  title: string;
  description: string;
  targetDate: DateKey | null;
  milestones: CompiledMilestone[];
  source: PlanSource;
  model: string | null;
  /** Archetype used by the template compiler, for transparency. */
  archetype: string;
  /** Assumptions and pacing notes shown alongside the plan. */
  notes: string[];
}

// ---- templates --------------------------------------------------------------

type T = [title: string, minutes: number, priority: Priority, energy?: Energy, notes?: string];
interface TemplateMilestone {
  title: string;
  description: string;
  projects: { title: string; tasks: T[] }[];
}
interface Archetype {
  id: string;
  label: string;
  match: RegExp;
  build: (subject: string, tech: boolean) => TemplateMilestone[];
}

const TECH = /\b(developer|engineer|engineering|programming|programmer|coding|code|software|backend|back-end|frontend|front-end|full[- ]?stack|devops|data scien|machine learning|ml|rust|python|typescript|javascript|java|go|golang|kotlin|swift|react|sql|cloud|kubernetes)\b/i;

/** "backend developer" reads badly in "practice X" sentences; name the skill instead of the role. */
export function skillTopic(subject: string): string {
  return subject
    .replace(/developer$/i, "development")
    .replace(/programmer$/i, "programming")
    .replace(/engineer$/i, "engineering")
    .replace(/designer$/i, "design")
    .replace(/writer$/i, "writing")
    .replace(/speaker$/i, "speaking")
    .replace(/cook$/i, "cooking");
}

const ARCHETYPES: Archetype[] = [
  {
    id: "exam",
    label: "Exam preparation",
    match: /\b(exam|exams|test|tests|finals|midterm|certification|certificate|ielts|toefl|gre|gmat|sat|bar|quiz|module|course|semester|university|college|school)\b/i,
    build: (s) => [
      {
        title: "Map the syllabus",
        description: "Know exactly what will be tested, when, and how much time you have.",
        projects: [
          {
            title: "Scope",
            tasks: [
              [`Collect the syllabus, past papers and dates for ${s}`, 45, 4, "low"],
              ["List every topic and rate your confidence from 1 to 5", 60, 3, "medium"],
              ["Block a weekly study rhythm around your fixed commitments", 30, 3, "low"],
            ],
          },
        ],
      },
      {
        title: "Build understanding",
        description: "Tackle weak topics first with active recall instead of re-reading.",
        projects: [
          {
            title: "Weak topics first",
            tasks: [
              ["Study the lowest-confidence topic with active recall", 90, 4, "high"],
              ["Turn that topic's notes into flashcards", 45, 2, "low"],
              ["Explain one hard concept aloud without notes", 30, 3, "medium"],
            ],
          },
          {
            title: "Steady coverage",
            tasks: [
              ["Work through the next two topics on the syllabus", 120, 3, "high"],
              ["Summarise each covered topic on a single page", 60, 2, "medium"],
            ],
          },
        ],
      },
      {
        title: "Practice under exam conditions",
        description: "Timed past papers expose gaps that studying alone hides.",
        projects: [
          {
            title: "Past papers",
            tasks: [
              ["Complete one timed past paper", 120, 4, "high"],
              ["Mark it and log every mistake by topic", 60, 3, "medium"],
              ["Redo every question you got wrong", 60, 3, "high"],
            ],
          },
        ],
      },
      {
        title: "Final review",
        description: "Consolidate, rest, and arrive prepared.",
        projects: [
          {
            title: "Consolidate",
            tasks: [
              ["Review the mistake log and flashcards", 45, 3, "medium"],
              ["Sit a final full mock exam", 150, 4, "high"],
              ["Prepare materials and logistics for exam day", 20, 2, "low"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "fitness",
    label: "Health & fitness",
    match: /\b(run|running|marathon|5k|10k|half[- ]marathon|fit|fitness|gym|lift|lifting|strength|weight|lose|muscle|health|healthy|sleep|diet|nutrition|yoga|swim|cycling|exercise|workout)\b/i,
    build: (s) => [
      {
        title: "Set your baseline",
        description: "Measure where you are so progress is visible.",
        projects: [
          {
            title: "Baseline",
            tasks: [
              [`Record a baseline measurement for ${s}`, 30, 3, "medium"],
              ["Choose a realistic weekly training schedule", 30, 4, "low"],
              ["Remove friction: prepare gear, route or gym bag", 20, 2, "low"],
            ],
          },
        ],
      },
      {
        title: "Build the habit",
        description: "Consistency beats intensity for the first weeks.",
        projects: [
          {
            title: "Training",
            tasks: [
              ["Training session 1", 60, 3, "high"],
              ["Training session 2", 60, 3, "high"],
              ["Training session 3", 60, 3, "high"],
            ],
          },
          {
            title: "Recovery",
            tasks: [
              ["Plan simple meals for the week", 45, 2, "low"],
              ["Set a consistent sleep window", 15, 2, "low"],
            ],
          },
        ],
      },
      {
        title: "Progress",
        description: "Increase load gradually and re-test.",
        projects: [
          {
            title: "Progression",
            tasks: [
              ["Increase training volume by about 10%", 60, 3, "high"],
              ["Re-test your baseline and compare", 45, 3, "medium"],
            ],
          },
        ],
      },
      {
        title: "Sustain",
        description: "Turn the result into a routine you keep.",
        projects: [
          {
            title: "Routine",
            tasks: [
              ["Review progress and adjust the plan", 30, 2, "low"],
              ["Schedule the next four weeks of training", 20, 2, "low"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "career",
    label: "Career move",
    match: /\b(job|career|promotion|promoted|interview|hired|role|position|raise|salary|internship|resume|cv)\b/i,
    build: (s) => [
      {
        title: "Positioning",
        description: "Be precise about the role you want and how you present yourself.",
        projects: [
          {
            title: "Profile",
            tasks: [
              ["Define target role, companies and must-haves", 45, 4, "medium"],
              [`Rewrite your CV for ${s}`, 120, 4, "high"],
              ["Refresh your portfolio or public profile", 90, 3, "high"],
            ],
          },
        ],
      },
      {
        title: "Build a pipeline",
        description: "A steady flow of tailored applications and conversations.",
        projects: [
          {
            title: "Applications",
            tasks: [
              ["Shortlist ten roles that match your must-haves", 60, 3, "medium"],
              ["Send five tailored applications", 120, 3, "medium"],
            ],
          },
          {
            title: "Network",
            tasks: [["Reach out to five people at target companies", 45, 3, "medium"]],
          },
        ],
      },
      {
        title: "Interview well",
        description: "Rehearse the stories that prove you can do the job.",
        projects: [
          {
            title: "Preparation",
            tasks: [
              ["Prepare stories for common behavioural questions", 90, 3, "high"],
              ["Do a mock interview and note what to improve", 60, 3, "high"],
              ["Research each company before its interview", 45, 2, "medium"],
            ],
          },
        ],
      },
      {
        title: "Decide",
        description: "Choose deliberately against what matters to you.",
        projects: [
          {
            title: "Offer",
            tasks: [
              ["Compare offers against your must-haves", 45, 3, "medium"],
              ["Negotiate and accept", 30, 4, "medium"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "writing",
    label: "Writing & creative work",
    match: /\b(write|writing|book|novel|blog|essay|thesis|dissertation|paper|article|newsletter|album|song|paint|portfolio|podcast|film)\b/i,
    build: (s) => [
      {
        title: "Shape the idea",
        description: "A clear premise and outline make the draft far easier.",
        projects: [
          {
            title: "Concept",
            tasks: [
              [`Write the core premise of ${s} in three sentences`, 30, 4, "high"],
              ["Outline the structure section by section", 90, 3, "high"],
              ["Set a realistic weekly output target", 15, 3, "low"],
            ],
          },
        ],
      },
      {
        title: "First draft",
        description: "Get it all down — editing comes later.",
        projects: [
          {
            title: "Drafting sessions",
            tasks: [
              ["Drafting session 1 — write without editing", 90, 4, "high"],
              ["Drafting session 2 — write without editing", 90, 3, "high"],
              ["Drafting session 3 — write without editing", 90, 3, "high"],
            ],
          },
          {
            title: "Momentum",
            tasks: [["Track output and adjust the target", 15, 2, "low"]],
          },
        ],
      },
      {
        title: "Revise",
        description: "Fix structure first, sentences last.",
        projects: [
          {
            title: "Revision",
            tasks: [
              ["Read the full draft and note structural issues", 120, 3, "high"],
              ["Revise the weakest section", 120, 3, "high"],
              ["Get feedback from two trusted readers", 30, 2, "medium"],
            ],
          },
        ],
      },
      {
        title: "Publish",
        description: "Ship it.",
        projects: [
          {
            title: "Release",
            tasks: [
              ["Final proofread", 90, 3, "medium"],
              [`Publish or submit ${s}`, 45, 4, "medium"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "build",
    label: "Build & launch",
    match: /\b(build|launch|ship|start|create|make|develop|open|app|website|site|product|startup|business|company|side project|shop|store|saas|game)\b/i,
    build: (s, tech) => [
      {
        title: "Define the first release",
        description: "Decide what you're making, for whom, and what 'done' means.",
        projects: [
          {
            title: "Brief",
            tasks: [
              [`Write a one-paragraph brief for ${s}: what, for whom, why`, 45, 4, "high"],
              ["Split scope into must-haves and nice-to-haves", 45, 3, "medium"],
              ["Define what 'done' means for the first release", 30, 3, "medium"],
            ],
          },
        ],
      },
      {
        title: "Build the core",
        description: "Get a thin, working version end to end before adding breadth.",
        projects: [
          {
            title: "Foundation",
            tasks: [
              [tech ? "Set up the repository, tooling and CI" : "Set up your workspace, tools and structure", 60, 3, "medium"],
              ["Build the smallest end-to-end version", 180, 4, "high"],
            ],
          },
          {
            title: "Core features",
            tasks: [
              ["Build must-have feature 1", 120, 3, "high"],
              ["Build must-have feature 2", 120, 3, "high"],
            ],
          },
        ],
      },
      {
        title: "Test with real people",
        description: "Early feedback is cheaper than late rework.",
        projects: [
          {
            title: "Feedback",
            tasks: [
              ["Show it to three people from the target audience", 45, 3, "medium"],
              ["Group the feedback into themes", 45, 2, "medium"],
              ["Fix the three most important issues", 120, 3, "high"],
            ],
          },
        ],
      },
      {
        title: "Launch",
        description: "Release it and learn from what happens.",
        projects: [
          {
            title: "Release",
            tasks: [
              ["Prepare launch materials: page, post, screenshots", 90, 2, "medium"],
              [`Launch ${s} and announce it`, 45, 4, "medium"],
              ["Review results one week after launch", 30, 2, "low"],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "skill",
    label: "Skill growth",
    match: /\b(learn|learning|become|better|improve|master|get good|skill|skills|practice|fluent|language|speak|understand|grow|develop my)\b/i,
    build: (role, tech) => {
      const s = skillTopic(role);
      return [
      {
        title: "Baseline & direction",
        description: "Know where you stand and choose what to focus on.",
        projects: [
          {
            title: "Assess",
            tasks: [
              [`Write down where you are with ${s} today and where you want to be`, 30, 3, "medium"],
              [tech ? `Pick a reference roadmap for ${s} and mark your gaps` : `Pick a curriculum or roadmap for ${s}`, 45, 3, "medium"],
              ["Choose three focus areas for this cycle", 30, 4, "medium"],
            ],
          },
        ],
      },
      {
        title: "Deliberate practice",
        description: "Short, focused practice with feedback on each focus area.",
        projects: [
          {
            title: "Focus areas",
            tasks: [
              [tech ? "Focus area 1: build a small exercise project" : "Focus area 1: hands-on practice", 90, 4, "high"],
              [tech ? "Focus area 2: build a small exercise project" : "Focus area 2: hands-on practice", 90, 3, "high"],
              [tech ? "Focus area 3: build a small exercise project" : "Focus area 3: hands-on practice", 90, 3, "high"],
            ],
          },
          {
            title: "Feedback loop",
            tasks: [
              [tech ? "Get a code review from a peer or mentor" : "Get feedback from a peer or mentor", 45, 2, "medium"],
              [tech ? `Read a well-regarded open-source codebase in ${s} and take notes` : `Study one high-quality resource on ${s} and take notes`, 60, 2, "medium"],
            ],
          },
        ],
      },
      {
        title: "Apply it to something real",
        description: "A capstone proves the skill in context.",
        projects: [
          {
            title: "Capstone",
            tasks: [
              ["Define a small capstone that uses all three focus areas", 45, 3, "medium"],
              ["Build the first working version", 180, 4, "high"],
              [tech ? "Write tests, document it and publish the code" : "Polish it and share it with someone", 90, 2, "medium"],
            ],
          },
        ],
      },
      {
        title: "Reflect & level up",
        description: "Close the loop and pick the next cycle.",
        projects: [
          {
            title: "Retrospective",
            tasks: [
              ["Review what improved and what still feels hard", 30, 2, "low"],
              ["Choose the next cycle's focus areas", 30, 2, "medium"],
            ],
          },
        ],
      },
      ];
    },
  },
];

const GENERAL: Archetype = {
  id: "general",
  label: "General goal",
  match: /.*/,
  build: (s) => [
    {
      title: "Clarify the outcome",
      description: "Make the goal concrete enough to act on.",
      projects: [
        {
          title: "Definition",
          tasks: [
            [`Define what success looks like for ${s}`, 30, 4, "medium"],
            ["Break it into three concrete outcomes", 45, 3, "high"],
            ["Name the likely obstacles and how you'll handle them", 30, 2, "medium"],
          ],
        },
      ],
    },
    {
      title: "First outcome",
      description: "Momentum comes from finishing something small early.",
      projects: [
        {
          title: "Outcome 1",
          tasks: [
            ["Take the first concrete step toward outcome 1", 60, 4, "high"],
            ["Keep working toward outcome 1", 90, 3, "high"],
            ["Check progress on outcome 1", 20, 2, "low"],
          ],
        },
      ],
    },
    {
      title: "Remaining outcomes",
      description: "Apply what worked to the rest.",
      projects: [
        {
          title: "Outcomes 2 & 3",
          tasks: [
            ["Work toward outcome 2", 90, 3, "high"],
            ["Work toward outcome 3", 90, 3, "high"],
          ],
        },
      ],
    },
    {
      title: "Review",
      description: "Decide what comes next.",
      projects: [
        { title: "Wrap-up", tasks: [["Review results and decide what's next", 30, 2, "low"]] },
      ],
    },
  ],
};

// ---- parsing -----------------------------------------------------------------

const LEAD = [
  /^(i\s+(really\s+)?(want|need|would like|'d like|hope|plan)\s+to\s+)/i,
  /^(help\s+me\s+(to\s+)?)/i,
  /^(my\s+goal\s+is\s+to\s+)/i,
  /^(get\s+ready\s+for|prepare\s+for|study\s+for|revise\s+for|train\s+for|pass|ace)\s+(my\s+|the\s+|a\s+|an\s+)?/i,
  /^(become|be)\s+(a|an)\s+(much\s+)?(better|great|good|strong|stronger|senior|confident)\s+/i,
  /^(become|be)\s+(a|an|more)\s+/i,
  /^(get\s+(much\s+)?(better|good)\s+at|improve\s+(at|in)|improve\s+my|improve|master|learn\s+(how\s+)?to|learn|practi[cs]e)\s+/i,
  /^(get\s+(a|an)\s+(new\s+)?(job|role|position)\s+(as|in)\s+(a|an)?\s*)/i,
  /^(build|launch|ship|start|create|make|write|finish|complete|run|lose|gain)\s+(a|an|my|the)?\s*/i,
];

/** Extracts the object of the goal ("backend developer", "university exams"). */
export function extractSubject(text: string): string {
  let s = text.trim().replace(/[.!?]+$/, "");
  for (let pass = 0; pass < 3; pass++) {
    for (const re of LEAD) s = s.replace(re, "");
  }
  s = s.trim();
  return s.length >= 2 ? s : text.trim().replace(/[.!?]+$/, "");
}

export function detectArchetype(text: string): Archetype {
  return ARCHETYPES.find((a) => a.match.test(text)) ?? GENERAL;
}

export function validateGoalText(text: string): string | null {
  const t = text.trim();
  if (t.length < 3) return "Describe your goal in a few words.";
  if (t.length > 240) return "Keep the goal under 240 characters — add detail in the description.";
  return null;
}

function goalTitle(text: string): string {
  const t = text.trim().replace(/[.!?]+$/, "");
  return t[0].toUpperCase() + t.slice(1);
}

// ---- compile -----------------------------------------------------------------

export function compileGoal(req: GoalRequest): CompiledPlan {
  const error = validateGoalText(req.text);
  if (error) throw new Error(error);
  const subject = extractSubject(req.text);
  const archetype = detectArchetype(req.text);
  const tech = TECH.test(req.text);
  const template = archetype.build(subject, tech);

  const totalMin = template.reduce(
    (sum, m) => sum + m.projects.reduce((s2, p) => s2 + p.tasks.reduce((s3, t) => s3 + t[1], 0), 0),
    0,
  );
  const hoursPerWeek = Math.max(1, Math.min(80, req.hoursPerWeek || 5));
  const notes: string[] = [];

  let target = req.targetDate && isValidDateKey(req.targetDate) ? req.targetDate : null;
  if (target && target <= req.today) {
    notes.push("The target date is today or in the past, so deadlines are paced from your weekly hours instead.");
    target = null;
  }
  const neededDays = Math.ceil((totalMin / 60 / hoursPerWeek) * 7);
  const spanDays = target ? daysBetween(req.today, target) : Math.max(7, neededDays);

  notes.push(
    `Estimated effort ≈ ${Math.round(totalMin / 60)}h. At ${hoursPerWeek}h per week that takes about ${Math.max(1, Math.round(neededDays / 7))} week${neededDays > 7 ? "s" : ""}.`,
  );
  if (target && neededDays > spanDays) {
    notes.push(
      `That is more than the ${spanDays} days until your target date — consider more hours per week, trimming tasks, or a later date.`,
    );
  }
  if (!target) notes.push("No target date set — milestone deadlines are paced from your weekly hours.");

  // Milestone deadlines are spread proportionally to their effort.
  let cumulative = 0;
  const milestones: CompiledMilestone[] = template.map((m) => {
    const mMin = m.projects.reduce((s, p) => s + p.tasks.reduce((s2, t) => s2 + t[1], 0), 0);
    cumulative += mMin;
    const deadline = addDays(req.today, Math.max(1, Math.round((spanDays * cumulative) / totalMin)));
    return {
      title: m.title,
      description: m.description,
      deadline,
      projects: m.projects.map((p) => ({
        title: p.title,
        tasks: p.tasks.map(([title, minutes, priority, energy, n]) => ({
          title,
          notes: n ?? "",
          priority,
          estimateMin: minutes,
          energy: energy ?? null,
          deadline,
        })),
      })),
    };
  });

  return {
    title: goalTitle(req.text),
    description: `${archetype.label} plan for “${subject}”.`,
    targetDate: target ?? milestones[milestones.length - 1]?.deadline ?? null,
    milestones,
    source: "template",
    model: null,
    archetype: archetype.label,
    notes,
  };
}

// ---- validation of plans from external providers -------------------------------

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Normalises an untrusted plan (e.g. parsed from a model's JSON) into a valid
 * CompiledPlan. Throws if nothing usable remains.
 */
export function sanitizePlan(raw: unknown, req: GoalRequest, source: PlanSource, model: string | null): CompiledPlan {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const ms = Array.isArray(obj.milestones) ? obj.milestones.slice(0, 8) : [];
  const milestones: CompiledMilestone[] = [];
  for (const mRaw of ms) {
    const m = (mRaw ?? {}) as Record<string, unknown>;
    const title = str(m.title, 120);
    if (!title) continue;
    const deadline = typeof m.deadline === "string" && isValidDateKey(m.deadline) && m.deadline > req.today ? m.deadline : null;
    const projects: CompiledProject[] = [];
    for (const pRaw of Array.isArray(m.projects) ? m.projects.slice(0, 6) : []) {
      const p = (pRaw ?? {}) as Record<string, unknown>;
      const tasks: CompiledTask[] = [];
      for (const tRaw of Array.isArray(p.tasks) ? p.tasks.slice(0, 10) : []) {
        const t = (tRaw ?? {}) as Record<string, unknown>;
        const tTitle = str(t.title, 160);
        if (!tTitle) continue;
        const energy = t.energy === "low" || t.energy === "medium" || t.energy === "high" ? t.energy : null;
        tasks.push({
          title: tTitle,
          notes: str(t.notes, 600),
          priority: clampInt(t.priority, 1, 4, 2) as Priority,
          estimateMin: clampInt(t.estimateMin, 5, 480, 45),
          energy,
          deadline,
        });
      }
      if (tasks.length) projects.push({ title: str(p.title, 120) || "Tasks", tasks });
    }
    if (projects.length) milestones.push({ title, description: str(m.description, 400), deadline, projects });
  }
  if (!milestones.length) throw new Error("The response did not contain a usable plan.");
  const notes = Array.isArray(obj.notes) ? obj.notes.map((n) => str(n, 300)).filter(Boolean).slice(0, 5) : [];
  return {
    title: str(obj.title, 160) || goalTitle(req.text),
    description: str(obj.description, 400),
    targetDate: req.targetDate,
    milestones,
    source,
    model,
    archetype: "Model-generated",
    notes,
  };
}
