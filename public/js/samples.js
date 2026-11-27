/**
 * One-click sample Intakes used to demo LifeBridge without personal data.
 * All people, places and messages below are fictional.
 *
 * @typedef {object} SampleIntake
 * @property {string} id Stable identifier.
 * @property {string} title Short button label.
 * @property {string} description One-line explanation shown on the samples page.
 * @property {('text' | 'photo' | 'voice' | 'live')[]} inputs Input types the sample exercises.
 * @property {string} icon Icon name from render.js.
 * @property {string} text Messy Intake text exactly as a user might type or paste it.
 * @property {boolean} [liveCheck] Whether the sample should enable the live web cross-check.
 * @property {{ name: string, lines: string[] }} [image] Fictional document drawn at runtime and attached as a PNG.
 */

/** @type {readonly SampleIntake[]} */
export const SAMPLES = Object.freeze([
  {
    id: 'road-accident',
    title: 'Roadside accident (Hinglish)',
    description: 'A panicked bystander message mixing Hindi and English: unconscious biker, heavy bleeding.',
    inputs: ['text'],
    icon: 'car',
    text:
      'Bhaiya jaldi help karo!! Highway pe Sector 9 flyover ke neeche, petrol pump ke saamne accident hua hai. ' +
      'Ek bike wala truck se takra gaya, helmet nahi tha. Uske sir se bahut khoon beh raha hai aur woh hosh mein nahi hai, ' +
      'saans chal rahi hai par dheere dheere. Peeche ek ladki baithi thi, uska haath shayad toot gaya hai, ro rahi hai. ' +
      'Truck driver bhaag gaya. Traffic bahut hai, log sirf video bana rahe hain. kya karein?? pls jaldi',
  },
  {
    id: 'medical-history',
    title: 'Elderly patient history',
    description: 'Caregiver notes with medicines, allergies and a low sugar reading to structure safely.',
    inputs: ['text'],
    icon: 'clipboard',
    text:
      'pt - Mrs Kamala R, 78 yrs, lives w/ son (son works night shift)\n' +
      'meds: metformin 500mg BD, Amlodipine 5 mg once daily , atorvastatin 20mg night, ecosprin 75 (after stent)\n' +
      'clopidogrel 75mg OD -- stopped?? ask dr\n' +
      'glimepride 1mg mornig\n' +
      'ALLERGIES: penicillin - rash. sulfa?? not sure\n' +
      'Hx: DM type2 since 2004, BP high 15+ yrs, angioplasty + stent 2019 (LAD), knee replacement R 2016\n' +
      'recent: dizzy x 3 days, sugar 62 this morning fasting, eating less bcoz of tooth pain\n' +
      'BP today 100/60 (usually 140/90)\n' +
      'cardiologist follow up missed in march',
  },
  {
    id: 'flood-warning',
    title: 'Flood warning + family at risk',
    description: 'A forwarded evacuation warning plus a family on the ground floor; cross-checked live.',
    inputs: ['text', 'live'],
    icon: 'waves',
    liveCheck: true,
    text:
      'Fwd: Fwd: *URGENT* Dam gates to be opened tonight 11pm, all low lying areas near the river to be EVACUATED. ' +
      'Share with all groups!! - District Control Room\n' +
      '---\n' +
      'my msg: water already entering ground floor in our lane near the lake, around knee height and rising. ' +
      'Power cut since 1 hr. My grandmother is on wheelchair, 2 kids (4 and 7 yrs). ' +
      'We are on ground floor only, no terrace access. Phone battery 30%. Is this msg real??',
  },
  {
    id: 'chest-pain',
    title: 'Chest pain, 62-year-old father',
    description: 'Classic heart attack warning signs in someone who refuses to go to hospital.',
    inputs: ['text'],
    icon: 'heart',
    text:
      'My father is 62, he suddenly has chest pain since 20 minutes, like heavy pressure, sweating a lot, ' +
      'pain going to his left arm and jaw. He is diabetic and smokes. He says its just gas and doesnt want ' +
      'to go to hospital. We are at home, nobody else here. what should i do',
  },
  {
    id: 'prescription-photo',
    title: 'Photo of a prescription',
    description: 'A handwritten prescription photo (generated on your device) read by Gemini.',
    inputs: ['text', 'photo'],
    icon: 'camera',
    text: 'Can you read this prescription and tell me what to watch out for?',
    image: {
      name: 'prescription-sample.png',
      lines: [
        'Rx   Dr. A. Mehta (fictional)',
        'Pt: Ramesh K, 54',
        '1) Tab Metformin 500 mg - 1-0-1 after food',
        '2) Tab Telmisartan 40 mg - 1-0-0',
        '3) Inj Insulin glargine 10 U night',
        'Allergy: Sulfa',
        'Review after 2 weeks',
      ],
    },
  },
  {
    id: 'traffic-weather',
    title: 'Traffic + weather alert',
    description: 'Road closure and rain alerts colliding with a dialysis appointment; cross-checked live.',
    inputs: ['text', 'live'],
    icon: 'cloud',
    liveCheck: true,
    text:
      'Fwd: TRAFFIC ADVISORY - Traffic Police: NH-48 closed near km 32 due to waterlogging, use service road. Expect long delays.\n' +
      'Fwd: Heavy rain alert (IMD style): ORANGE ALERT for the district, very heavy rainfall likely next 24 hrs, avoid low lying roads.\n' +
      '---\n' +
      'my mother is on dialysis, appointment at 4pm at city hospital across the highway, she missed the last one. ' +
      'we have no car, only auto. what do we do?',
  },
]);

/**
 * Draws a fictional, handwriting-style document onto a canvas and returns it as a PNG Blob.
 * Used by image samples so the demo exercises the photo path without real patient data.
 * @param {string[]} lines Text lines to draw.
 * @param {Document} [doc]
 * @returns {Promise<Blob | null>} null when the browser cannot draw on a canvas.
 */
export function drawSampleImage(lines, doc = document) {
  const width = 900;
  const lineHeight = 64;
  const canvas = Object.assign(doc.createElement('canvas'), { width, height: 120 + lines.length * lineHeight });
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = '#fbf8ef'; // paper
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.strokeStyle = '#c9d7e6'; // ruled lines
  for (let y = 110; y < canvas.height; y += lineHeight) {
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(width - 40, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#1d3a8a'; // ballpoint ink
  ctx.font = 'italic 34px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
  lines.forEach((line, n) => {
    ctx.save();
    ctx.translate(60 + (n % 2) * 6, 100 + n * lineHeight);
    ctx.rotate(((n % 3) - 1) * 0.012); // slight hand-written wobble
    ctx.fillText(line, 0, 0);
    ctx.restore();
  });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
