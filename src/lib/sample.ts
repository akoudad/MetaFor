import type { Conversation, Message, Section } from "./model";

function exchange(id: string, question: string, sections: Section[]): Message[] {
  return [
    {
      id: `${id}-question`,
      role: "user",
      sections: [{ id: `${id}-prompt`, title: "", body: question }],
    },
    { id: `${id}-answer`, role: "assistant", sections },
  ];
}

// Prewritten content for testing navigation. These are not live model answers.
const sampleConversation: Conversation = {
  id: "sample-career-space",
  title: "Finding your next role",
  rootId: "job-search",
  explorations: {
    "job-search": {
      id: "job-search",
      title: "Finding your next role",
      summary: "Explore companies, choose a direction, and make a practical plan.",
      parentId: null,
      source: null,
      position: [0, 0, 0],
      messages: exchange("job-search", "How do I find a great job in tech?", [
        {
          id: "companies",
          title: "Choose companies worth exploring",
          body: "Start with a small shortlist of teams whose work interests you. Google, Meta, and NVIDIA are examples to investigate, alongside smaller companies. Look at the role, the team, and what you would actually build.\n\nCompensation is one part of that comparison. A salary headline can hide differences in equity, benefits, location, and the timing of payments.",
        },
        {
          id: "priorities",
          title: "Find the role that fits you",
          body: "Compare software engineering, applied machine learning, and research engineering through the work each involves. Match the role to evidence you can show: a useful product, a deployed model, or a carefully evaluated experiment.\n\nYour priorities might include learning, compensation, location, or the kind of problems you enjoy. Keep those priorities visible as you explore.",
        },
        {
          id: "interviews",
          title: "Prepare while you apply",
          body: "Treat getting an interview and doing well in it as separate tasks. A clear project story helps someone understand your work; focused practice helps you explain decisions and solve unfamiliar problems.\n\nUse feedback from real conversations to decide what to practice next.",
        },
        {
          id: "weekly-plan",
          title: "Make a manageable weekly plan",
          body: "Choose a few relevant opportunities, tailor the applications, and keep a simple record of what happens. Leave time for practice and one project you can explain clearly.\n\nAt the end of the week, look for a bottleneck. Adjust the next week around that evidence rather than adding more tasks.",
        },
      ]),
    },
    compensation: {
      id: "compensation",
      title: "Compare compensation",
      summary: "Understand the package behind the salary headline.",
      parentId: "job-search",
      source: { explorationId: "job-search", messageId: "job-search-answer", sectionId: "companies" },
      position: [-4, 1, -5],
      messages: exchange("compensation", "How should I compare their compensation?", [
        {
          id: "compensation-package",
          title: "Compare the whole package",
          body: "Put base salary, expected bonus, equity, and one-time payments in separate columns. Compare the same role level and location. An attractive first-year total may include a signing bonus that does not recur.",
        },
        {
          id: "compensation-equity",
          title: "Understand the equity",
          body: "A grant is not the same as cash available today. Ask what you receive, when you earn it, and whether you can sell it. A package becomes easier to assess once those pieces are explicit.",
        },
        {
          id: "compensation-tradeoffs",
          title: "Bring your priorities back in",
          body: "Consider the work, learning opportunities, location, and time demands alongside the package. Keep uncertain figures labeled as estimates. This sample explains the comparison process; it does not provide current salary data.",
        },
      ]),
    },
    equity: {
      id: "equity",
      title: "Understand equity",
      summary: "Separate the grant, its value, and when it becomes yours.",
      parentId: "compensation",
      source: { explorationId: "compensation", messageId: "compensation-answer", sectionId: "compensation-equity" },
      position: [-6, 1, -10],
      messages: exchange("equity", "What should I understand about equity?", [
        {
          id: "equity-instrument",
          title: "Know what is being offered",
          body: "The details depend on the instrument and the grant agreement. Shares, restricted stock units, and options are different. Start with the actual offer documents rather than assuming every company uses the same arrangement.",
        },
        {
          id: "equity-vesting",
          title: "Read the vesting schedule",
          body: "Vesting describes when you earn the grant under its conditions. The schedule can change how much of a headline package you actually receive during a particular period.",
        },
        {
          id: "equity-liquidity",
          title: "Check when it can be sold",
          body: "Ownership and the ability to sell are separate questions. Ask about trading restrictions and available sale opportunities. Keep uncertain future value separate from cash compensation.",
        },
      ]),
    },
    vesting: {
      id: "vesting",
      title: "Read a vesting schedule",
      summary: "A closer look at when a grant is earned.",
      parentId: "equity",
      source: { explorationId: "equity", messageId: "equity-answer", sectionId: "equity-vesting" },
      position: [-8, 1, -15],
      messages: exchange("vesting", "What would I look for in that schedule?", [
        {
          id: "vesting-dates",
          title: "Start with the dates",
          body: "Find the grant date, first vesting date, and subsequent installments. A cliff means a portion is earned only after an initial period. The actual agreement determines the conditions.",
        },
        {
          id: "vesting-example",
          title: "Put it on a timeline",
          body: "For a hypothetical grant of 100 units vesting equally over four years, 25 units would vest each year. Real schedules may use different intervals or conditions. This example illustrates timing, not the value of an offer.",
        },
        {
          id: "vesting-return",
          title: "Return to the comparison",
          body: "Now you can distinguish the total grant from the amount expected to vest in one year. Step back to compensation to use that distinction, or return to the main discussion to explore your priorities.",
        },
      ]),
    },
    priorities: {
      id: "priorities",
      title: "Choose your direction",
      summary: "Match the role to the work you want to do.",
      parentId: "job-search",
      source: { explorationId: "job-search", messageId: "job-search-answer", sectionId: "priorities" },
      position: [4, 1, -5],
      messages: exchange("priorities", "How do I decide which role suits me?", [
        {
          id: "priorities-work",
          title: "Look at the daily work",
          body: "Compare example job descriptions by the activities they emphasize: building product features, operating models, designing experiments, or improving infrastructure. Titles alone do not explain how a team spends its time.",
        },
        {
          id: "priorities-evidence",
          title: "Connect it to your evidence",
          body: "Choose projects that demonstrate the work you want to do. Explain the problem, your decisions, the result, and what you would improve. Identify the gaps you can realistically address next.",
        },
        {
          id: "priorities-choice",
          title: "Choose a starting direction",
          body: "Pick a primary track and one adjacent option. You can revise the choice as you learn more. The compensation exploration remains available when you want to compare opportunities across these priorities.",
        },
      ]),
    },
    interviews: {
      id: "interviews",
      title: "Prepare for conversations",
      summary: "Practice explaining your work and solving problems.",
      parentId: "job-search",
      source: { explorationId: "job-search", messageId: "job-search-answer", sectionId: "interviews" },
      position: [-4, -3, -5],
      messages: exchange("interviews", "What should interview preparation include?", [
        {
          id: "interviews-project",
          title: "Tell one project story clearly",
          body: "Describe the problem, your contribution, a difficult decision, and what happened. Prepare to discuss a limitation as comfortably as a success.",
        },
        {
          id: "interviews-practice",
          title: "Practice the relevant skills",
          body: "Use the role description to guide practice. Explain your assumptions, work through examples, and review what confused you. A short feedback loop is more useful than an ever-growing list of topics.",
        },
      ]),
    },
    "weekly-plan": {
      id: "weekly-plan",
      title: "Plan the next week",
      summary: "Keep a few useful actions and review the results.",
      parentId: "job-search",
      source: { explorationId: "job-search", messageId: "job-search-answer", sectionId: "weekly-plan" },
      position: [4, -3, -5],
      messages: exchange("weekly-plan", "How can I keep this manageable each week?", [
        {
          id: "weekly-actions",
          title: "Choose a small set of actions",
          body: "Select relevant openings, submit a few considered applications, practice one weak area, and improve one piece of project evidence. Set a workload you can actually repeat.",
        },
        {
          id: "weekly-review",
          title: "Review the evidence",
          body: "Record responses and what you learned. Decide whether the next week needs better targeting, clearer applications, or more practice. Return to the corresponding topic whenever you need detail.",
        },
      ]),
    },
  },
};

export function createSampleConversation(): Conversation {
  return structuredClone(sampleConversation);
}
