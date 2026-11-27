/**
 * One-click sample Intakes used to demo LifeBridge without personal data.
 * All people, places and messages below are fictional.
 *
 * @typedef {object} SampleIntake
 * @property {string} id Stable identifier.
 * @property {string} title Short button label.
 * @property {string} text Messy Intake text exactly as a user might type or paste it.
 * @property {boolean} [liveCheck] Whether the sample should enable the live web cross-check.
 */

/** @type {readonly SampleIntake[]} */
export const SAMPLES = Object.freeze([
  {
    id: 'road-accident',
    title: 'Roadside accident (Hinglish)',
    text:
      'Bhaiya jaldi help karo!! Highway pe Sector 9 flyover ke neeche, petrol pump ke saamne accident hua hai. ' +
      'Ek bike wala truck se takra gaya, helmet nahi tha. Uske sir se bahut khoon beh raha hai aur woh hosh mein nahi hai, ' +
      'saans chal rahi hai par dheere dheere. Peeche ek ladki baithi thi, uska haath shayad toot gaya hai, ro rahi hai. ' +
      'Truck driver bhaag gaya. Traffic bahut hai, log sirf video bana rahe hain. kya karein?? pls jaldi',
  },
  {
    id: 'medical-history',
    title: 'Elderly patient history',
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
    text:
      'My father is 62, he suddenly has chest pain since 20 minutes, like heavy pressure, sweating a lot, ' +
      'pain going to his left arm and jaw. He is diabetic and smokes. He says its just gas and doesnt want ' +
      'to go to hospital. We are at home, nobody else here. what should i do',
  },
]);
