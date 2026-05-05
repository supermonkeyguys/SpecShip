import { GlucoseRecordRepository } from "./.shipyard/projects/proj-1777822225464/sessions/sess-1777822225475/output/record-repository";

async function runTest() {
  try {
    const result = await new GlucoseRecordRepository().create({ patientId: 'p1', measuredAt: '2024-01-01T00:00:00.000Z', glucoseValue: 5.5, unit: 'mmol/L' });
    const expected = "\"patientId\":\"p1\"";
    const ok = JSON.stringify(result) === JSON.stringify(expected) || String(result).includes(String(expected));
    if (!ok) { console.error("FAIL: expected", expected, "got", result); process.exit(1); }
    console.log("PASS");
  } catch (e) {
    console.error("FAIL: unexpected error:", e); process.exit(1);
  }
}

runTest().catch(e => { console.error(e); process.exit(1); });