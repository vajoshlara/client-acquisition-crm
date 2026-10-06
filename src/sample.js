/* ============================================================ sample data (fictional, tagged "Sample")
 * Built by replaying real actions with a shifted clock, so timelines, milestones,
 * automations and analytics behave exactly as they would with real use. */

function loadSampleData(d) {
  if (!d.settings.tags.some(t => t.id === 'tag_sample')) d.settings.tags.push({ id: 'tag_sample', name: 'Sample', tone: 'slate' });
  touch(d.settings);
  const S = n => slugId('src', n), V = n => slugId('svc', n), T = n => slugId('tag', n);
  const EA = V('Executive Assistance'), SM = V('Social Media Management'), BOTH = V('Executive Assistance + Social Media');
  const DAY = 86400000;
  // path: [stageKey, daysAfterPrevious, ctx?]
  const rows = [
    { company: 'Brightside Coaching Co.', contactName: 'Dana Whitlock', title: 'Executive Assistant (20 hrs/week)', src: 'Upwork', svc: EA, tags: ['Executive Assistant', 'Coach', 'Remote'], pr: 'high', tp: 'hot', rate: '$9/hr', ago: 26,
      path: [['research', 1], ['applied', 1], ['replied', 3], ['interview', 4, { interviewAt: 'IV+2@10:00' }], ['proposal', 6], ['won', 5]],
      note: 'Founder runs group coaching programs. Calendar is chaos across three time zones — lead with the calendar audit idea.' },
    { company: 'Northwind Realty Group', contactName: 'Marcus Lee', title: 'Social Media Manager for a real-estate team', src: 'LinkedIn', svc: SM, tags: ['Social Media', 'Local Business'], pr: 'high', tp: 'hot', rate: '$700/month', ago: 18,
      path: [['applied', 0], ['replied', 4], ['interview', 3, { interviewAt: 'TODAY+2@21:00' }]],
      note: 'Wants 4 reels a week from listing walk-throughs. Ask what they use for scheduling now.' },
    { company: 'Lumen Wellness Studio', contactName: 'Priya Natarajan', title: 'Instagram content & community', src: 'Instagram', svc: SM, tags: ['Social Media', 'High Potential'], pr: 'medium', tp: 'warm', rate: '$8/hr', ago: 21,
      path: [['applied', 0], ['replied', 5], ['follow_up', 2, { followUpDate: 'TODAY' }]] },
    { company: 'Harbor & Pine Marketing', contactName: 'Elena Ruiz', title: 'EA to agency founder', src: 'Referral', svc: EA, tags: ['Executive Assistant', 'Agency', 'High Potential'], pr: 'high', tp: 'hot', rate: '$10/hr', ago: 12,
      path: [['applied', 0], ['replied', 2], ['interview', 2, { interviewAt: 'AGO+1@09:30' }], ['proposal', 3]],
      note: 'Referred by a former colleague. Proposal covered inbox + project tracking in ClickUp.' },
    { company: 'Kestrel Podcast Network', contactName: 'Owen Hartley', title: 'Podcast clips & YouTube scheduling', src: 'Job Board', svc: SM, tags: ['Social Media'], pr: 'medium', tp: 'warm', ago: 34,
      path: [['applied', 0], ['replied', 6], ['interview', 3, { interviewAt: 'AGO+2@20:00' }], ['lost', 6, { lostReason: 'Hired someone else' }]] },
    { company: 'Atlas Freight Partners', contactName: 'Grace Okafor', title: 'Administrative support (logistics)', src: 'Job Board', svc: EA, tags: ['Executive Assistant'], pr: 'low', tp: 'cold', ago: 55,
      path: [['applied', 0], ['lost', 20, { lostReason: 'No response' }]] },
    { company: 'Saltwater Skincare', contactName: 'Mia Torres', title: 'Social media + inbox for a DTC brand', src: 'Direct Outreach', svc: BOTH, tags: ['Social Media', 'E-commerce'], pr: 'medium', tp: 'warm', ago: 9,
      path: [['research', 1], ['applied', 1], ['follow_up', 4, { followUpDate: 'AGO-2' }]] },
    { company: 'Juniper Sales Academy', contactName: 'Tom Becker', title: 'EA for sales coach', src: 'Upwork', svc: EA, tags: ['Coach', 'Executive Assistant'], pr: 'medium', tp: 'warm', ago: 7,
      path: [['applied', 0], ['replied', 3]] },
    { company: 'Ridgeview Dental', contactName: 'Dr. Hannah Cole', title: 'Facebook page & review replies', src: 'Facebook', svc: SM, tags: ['Local Business'], pr: 'low', tp: 'cold', ago: 63,
      path: [['applied', 0], ['replied', 8], ['lost', 9, { lostReason: 'Budget too low' }]] },
    { company: 'Copperleaf Agency', contactName: 'Sam Patel', title: 'Social media coordinator (agency)', src: 'LinkedIn', svc: SM, tags: ['Agency', 'Social Media'], pr: 'medium', tp: 'warm', ago: 4,
      path: [['research', 1], ['applied', 1]] },
    { company: 'Meadow & Co. Bakery', contactName: 'Lucy Grant', title: 'Instagram for a two-location bakery', src: 'Instagram', svc: SM, tags: ['Local Business', 'Social Media'], pr: 'low', tp: 'cold', ago: 2,
      path: [] },
    { company: 'Orbit Fitness App', contactName: 'Diego Alvarez', title: 'Founder support: inbox, calendar, investor updates', src: 'LinkedIn', svc: EA, tags: ['Executive Assistant', 'International'], pr: 'high', tp: 'warm', ago: 3,
      path: [['research', 0]] },
    { company: 'Sora Life Coaching', contactName: 'Aiko Mendez', title: 'Content calendar & Canva graphics', src: 'Referral', svc: SM, tags: ['Coach', 'Social Media'], pr: 'medium', tp: 'hot', ago: 80,
      path: [['applied', 0], ['replied', 2], ['interview', 3, { interviewAt: 'AGO+1@11:00' }], ['proposal', 2], ['won', 4]] },
    { company: 'Bluebird Events', contactName: 'Nora Quinn', title: 'Event coordination assistant', src: 'Upwork', svc: EA, tags: ['Executive Assistant'], pr: 'low', tp: 'cold', ago: 110,
      path: [['applied', 0], ['replied', 9]], archive: 'Position paused' }
  ];
  const created = [];
  const realOffset = Clock.offsetMs;
  try {
    rows.forEach((r, i) => {
      Clock.offsetMs = realOffset - r.ago * DAY + i * 60000;
      const resolve = v => {
        if (!v) return v;
        const at = v.split('@');
        let date;
        if (at[0] === 'TODAY') date = toDateStr(new Date(Date.now() + realOffset));
        else if (/^TODAY\+/.test(at[0])) date = addDays(toDateStr(new Date(Date.now() + realOffset)), +at[0].slice(6));
        else if (/^AGO-/.test(at[0])) date = addDays(toDateStr(new Date(Date.now() + realOffset)), -at[0].slice(4));
        else if (/^AGO\+|^IV\+/.test(at[0])) date = addDays(todayStr(), +at[0].split('+')[1]);
        else date = at[0];
        return at[1] ? date + 'T' + at[1] : date;
      };
      const p = createProspect(d, {
        company: r.company, contactName: r.contactName, title: r.title, sourceId: S(r.src), serviceId: r.svc,
        email: r.contactName.split(' ').slice(-1)[0].toLowerCase() + '@' + r.company.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '') + '.example',
        website: r.company.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '') + '.example',
        priority: r.pr, temperature: r.tp, expectedRate: r.rate || '', discoveredDate: todayStr(),
        tagIds: r.tags.map(T).concat('tag_sample'),
        description: 'Fictional sample opportunity for exploring the CRM.'
      });
      p.sample = true;
      if (r.note) addNote(d, p.id, r.note);
      r.path.forEach(([key, gap, ctx]) => {
        Clock.offsetMs += gap * DAY;
        const c = Object.assign({}, ctx || {});
        if (c.interviewAt) c.interviewAt = resolve(c.interviewAt);
        if (c.followUpDate) c.followUpDate = resolve(c.followUpDate);
        moveStage(d, p.id, stageByKey(d, key).id, c);
      });
      if (r.archive) { Clock.offsetMs += 5 * DAY; archiveProspect(d, p.id, r.archive, ''); }
      created.push(p);
    });
  } finally {
    Clock.offsetMs = realOffset;
  }
  // tidy history: old automation tasks from the replayed past are marked done, recent ones stay open
  const cutoff = addDays(todayStr(), -2);
  created.forEach(p => {
    Object.values(d.tasks).filter(t => t.prospectId === p.id && taskOpen(t) && t.dueDate && t.dueDate < cutoff).forEach(t => {
      t.status = 'done'; t.completedAt = new Date(parseDateStr(t.dueDate).getTime() + 15 * 3600000).toISOString(); touch(t);
    });
    Object.values(d.jobs).filter(j => j.prospectId === p.id && new Date(j.runAt).getTime() < nowMs()).forEach(j => { delete d.jobs[j.id]; });
  });
  // a couple of hand-made tasks
  const by = name => created.find(p => p.company === name);
  createTask(d, { title: 'Send portfolio link + calendar audit idea', dueDate: todayStr(), priority: 'high', prospectId: by('Juniper Sales Academy').id, type: 'general' });
  createTask(d, { title: 'Research Orbit’s investor update format', dueDate: addDays(todayStr(), 1), priority: 'medium', prospectId: by('Orbit Fitness App').id, type: 'research' });
  createTask(d, { title: 'Update Canva portfolio with two new reels', dueDate: addDays(todayStr(), -1), priority: 'medium', type: 'general' });
  return created.length;
}
