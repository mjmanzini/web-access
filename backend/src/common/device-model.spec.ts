import { decodeModel } from './device-model';

/**
 * Identification is only worth having if it is trustworthy. These tests are
 * mostly about the cases where the right answer is "I don't know" — a
 * confident wrong model ends a parent's investigation, which is worse than
 * showing them nothing.
 */
describe('decodeModel', () => {
  it('decodes the Samsung factory code that started all this', () => {
    // The ghost device on this household's network, announcing itself with a
    // part number and nothing else.
    expect(decodeModel('SM-L330')).toEqual({
      code: 'SM-L330',
      model: 'Galaxy Watch8 (44mm)',
      kind: 'watch',
    });
  });

  it('finds a code embedded in a longer hostname', () => {
    expect(decodeModel('Galaxy-SM-X205-kids')).toMatchObject({
      code: 'SM-X205',
      model: 'Galaxy Tab A8 (LTE)',
      kind: 'tablet',
    });
  });

  it('strips a region suffix to reach the base model', () => {
    expect(decodeModel('SM-G991B')).toMatchObject({ model: 'Galaxy S21' });
  });

  it('keeps the code but admits the model is unknown', () => {
    // The code is real and useful — it is searchable, and it is evidence.
    // Inventing "Galaxy S99" from the pattern would not be.
    expect(decodeModel('SM-Z999')).toEqual({ code: 'SM-Z999', model: null, kind: null });
  });

  it("decodes Samsung's owner-plus-model default hostname", () => {
    expect(decodeModel('Maria-s-A56')).toMatchObject({ model: 'Galaxy A56', kind: 'phone' });
    expect(decodeModel('2-s-A54')).toMatchObject({ model: 'Galaxy A54' });
  });

  it('does not claim a model from a bare number in a name', () => {
    // "A56" inside an arbitrary label is not a device model. Without the "-s-"
    // signal this must stay silent.
    expect(decodeModel('Room A56 printer').model).toBeNull();
    expect(decodeModel('Tab-80-Kids').model).toBeNull();
  });

  it('reads other vendors that name themselves plainly', () => {
    expect(decodeModel("Njabulo's iPhone")).toMatchObject({ model: 'iPhone', kind: 'phone' });
    expect(decodeModel('Pixel-7-Pro')).toMatchObject({ model: 'Pixel 7 Pro' });
    expect(decodeModel('living-room-Chromecast')).toMatchObject({ kind: 'tv' });
    expect(decodeModel('PS5-lounge')).toMatchObject({ model: 'PlayStation 5', kind: 'console' });
  });

  it('says nothing about generic and empty hostnames', () => {
    // A Windows default name identifies the OS, not the hardware.
    expect(decodeModel('DESKTOP-VPURVNV').model).toBeNull();
    expect(decodeModel('LAPTOP-8H2K1')).toEqual({ code: null, model: null, kind: null });
    expect(decodeModel('')).toEqual({ code: null, model: null, kind: null });
    expect(decodeModel(null)).toEqual({ code: null, model: null, kind: null });
  });
});
