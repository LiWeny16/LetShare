export type SettingsSearchSection = { id: string; title: string; items: string[][] };
export type SettingsSearchResult = { id: string; indices: number[] };

/** Match translated titles, descriptions, option labels and device names. */
export function searchMeetingSettings(sections: SettingsSearchSection[], text: string): SettingsSearchResult[] {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  const query = normalize(text.trim());
  return sections.flatMap((section) => {
    const matchesTitle = !query || normalize(section.title).includes(query);
    const indices = section.items.flatMap((terms, index) =>
      matchesTitle || terms.some((term) => normalize(term).includes(query)) ? [index] : [],
    );
    return indices.length ? [{ id: section.id, indices }] : [];
  });
}

/** Keep the selected category when visible; otherwise point at the first match. */
export function activeMeetingSettingsSection(results: SettingsSearchResult[], selected: string): string | undefined {
  return results.some((result) => result.id === selected) ? selected : results[0]?.id;
}

/** Calculate a section's position in the dialog's own scroll container. */
export function meetingSettingsScrollTop(current: number, containerTop: number, sectionTop: number): number {
  return Math.max(0, current + sectionTop - containerTop - 16);
}
