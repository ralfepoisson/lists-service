import type { SeedLoopInput } from '../application/LoopService.js';

export const approvedOpenLoopSeeds: readonly SeedLoopInput[] = [
  {
    seedKey: 'approved-2026-10-03-co-parenting-v1',
    title: 'Co-parenting',
    description:
      'Unsettled co-parenting arrangements and expectations, including child-support scope, additional expenses, third-party involvement, transport, childcare and disclosure where evidenced.',
    outcome: 'A workable co-parenting arrangement and expectations are established.'
  },
  {
    seedKey: 'approved-2026-10-03-autism-investigation-v1',
    title: 'Autism investigation',
    description:
      "Understanding Ralfe's neurodevelopmental profile and the implications of the investigation. This does not assert an autism diagnosis.",
    outcome:
      'The investigation and feedback are understood and any supported next steps are decided.',
    relatedRecords: [
      { kind: 'email', recordId: '1a01eb7657901c21', label: 'NPSI assessment correspondence' }
    ]
  },
  {
    seedKey: 'approved-2026-10-03-recurrent-dizziness-v1',
    title: 'Recurrent dizziness',
    description:
      'Ongoing dizziness and its investigation or management, including a suspected orthostatic blood-pressure component only where evidenced.',
    outcome:
      'The dizziness has been appropriately investigated and a management plan is understood.',
    relatedRecords: [
      { kind: 'email', recordId: '19fa37aae728f9bd', label: 'Correspondence with Dr Stähle' },
      {
        kind: 'task',
        recordId: '6hRWxc7F77jVRr2P',
        label: 'Discuss orthostatic blood-pressure testing with Dr Stähle'
      }
    ]
  },
  {
    seedKey: 'approved-2026-10-03-chronic-fatigue-v1',
    title: 'Chronic fatigue',
    description:
      'Ongoing fatigue and its investigation or management. This symptom label does not establish a specific syndrome or cause.',
    outcome: 'The fatigue investigations and supported next steps are understood.',
    relatedRecords: [
      {
        kind: 'task',
        recordId: '6hMggVpvx2mgRpfP',
        label: '[Next] Complete iron & inflammation reassessment'
      },
      {
        kind: 'task',
        recordId: '6hXJrQJxqjrvG2Cm',
        label: 'Arrange Rothen H. pylori breath test and iron blood tests'
      }
    ]
  },
  {
    seedKey: 'approved-2026-10-03-left-wrist-v1',
    title: 'Ongoing left wrist problems',
    description:
      'The wrist treatment and recovery pathway, including preparation, insurer approval, planned surgery, follow-up, rehabilitation and assessment of resulting symptoms or function.',
    outcome:
      'The treatment and recovery pathway is complete and resulting function has been assessed.',
    relatedRecords: [
      {
        kind: 'email',
        recordId: '1a05a01f28c8fb26',
        label: 'Wrist surgery and insurance correspondence'
      }
    ]
  },
  {
    seedKey: 'approved-2026-10-03-life-insurance-v1',
    title: 'Life insurance',
    description: 'The unresolved life-insurance arrangement intended to benefit Mila and Allegra.',
    outcome: 'The intended cover is selected, effective and confirmed.',
    relatedRecords: [
      {
        kind: 'task',
        recordId: '6hR39P28cWP6pj3w',
        label: 'Arrange life insurance with a lump-sum payout to my children'
      }
    ]
  },
  {
    seedKey: 'approved-2026-10-03-belamy-sparrow-vet-v1',
    title: "Belamy and Sparrow's veterinary needs",
    description:
      'Outstanding veterinary care and recovery needs for Belamy and Sparrow, including appointments, procedures, collection and recovery arrangements.',
    outcome: 'Their outstanding veterinary care and recovery needs are addressed.'
  },
  {
    seedKey: 'approved-2026-10-03-piano-lessons-v1',
    title: 'Piano lessons for children',
    description:
      'Establishing a suitable and sustainable piano-learning arrangement for Mila and Allegra.',
    outcome: 'A suitable, sustainable piano-learning arrangement is in place.',
    relatedRecords: [
      { kind: 'email', recordId: '1a0574f699e458d8', label: 'Piano lessons provider information' }
    ]
  },
  {
    seedKey: 'approved-2026-10-03-graduation-uk-trip-v1',
    title: 'Graduation and UK trip',
    description:
      'The Open University graduation on 25 November 2026 and associated UK travel through completion.',
    outcome: 'The graduation is attended and associated UK travel is completed.',
    relatedRecords: [
      {
        kind: 'email',
        recordId: '1a04799f60e72c87',
        label: 'Open University graduation correspondence'
      },
      {
        kind: 'task',
        recordId: '6h9vgPJrJmpfMJgP',
        label: 'Book London accommodation for the graduation trip'
      },
      { kind: 'task', recordId: '6h9vgPMc9RG75G8P', label: 'Book travel from London to Wales' },
      {
        kind: 'task',
        recordId: '6h9vgPQhRmCHqr2w',
        label: 'Book accommodation for the Wales trip'
      },
      { kind: 'task', recordId: '6hVf5MpQCmRCW98w', label: 'Plan Graduation Trip' }
    ]
  }
];
