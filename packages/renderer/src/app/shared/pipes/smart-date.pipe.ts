import { Pipe, PipeTransform } from '@angular/core';

/**
 * SmartDatePipe - Intelligently formats dates showing only relevant components
 *
 * When used in a list context, it only shows date components that differ from
 * the previous entry to reduce visual clutter.
 *
 * Usage:
 * - {{ date | smartDate }}                    - Full smart format
 * - {{ date | smartDate:previousDate }}       - Context-aware format
 * - {{ date | smartDate:previousDate:'full' }} - Always show full date
 *
 * Examples (assuming current year is 2026):
 * - Same day as previous: "2:34 PM"
 * - Different day, same month: "15 2:34 PM"
 * - Different month: "Jan 15 2:34 PM"
 * - Different year: "2025 Jan 15 2:34 PM"
 */
@Pipe({
  name: 'smartDate',
  standalone: true,
})
export class SmartDatePipe implements PipeTransform {
  transform(
    value: string | Date | null | undefined,
    previousValue?: string | Date | null,
    mode: 'smart' | 'full' = 'smart'
  ): string {
    if (!value) return '';

    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    const previousDate = previousValue
      ? previousValue instanceof Date
        ? previousValue
        : new Date(previousValue)
      : null;

    // Full mode always shows everything
    if (mode === 'full') {
      return this.formatFull(date, now);
    }

    // Smart mode compares against previous date
    return this.formatSmart(date, previousDate, now);
  }

  private formatSmart(date: Date, previousDate: Date | null, now: Date): string {
    const timeStr = this.formatTime(date);

    // If no previous date, show based on current date comparison
    if (!previousDate) {
      return this.formatRelativeToNow(date, now, timeStr);
    }

    const dateYear = date.getFullYear();
    const dateMonth = date.getMonth();
    const dateDay = date.getDate();

    const prevYear = previousDate.getFullYear();
    const prevMonth = previousDate.getMonth();
    const prevDay = previousDate.getDate();

    // Same exact day - just show time
    if (dateYear === prevYear && dateMonth === prevMonth && dateDay === prevDay) {
      return timeStr;
    }

    // Same year and month, different day
    if (dateYear === prevYear && dateMonth === prevMonth) {
      return `${dateDay} ${timeStr}`;
    }

    // Same year, different month
    if (dateYear === prevYear) {
      return `${this.getMonthAbbr(dateMonth)} ${dateDay} ${timeStr}`;
    }

    // Different year
    return `${dateYear} ${this.getMonthAbbr(dateMonth)} ${dateDay} ${timeStr}`;
  }

  private formatRelativeToNow(date: Date, now: Date, timeStr: string): string {
    const dateYear = date.getFullYear();
    const dateMonth = date.getMonth();
    const dateDay = date.getDate();

    const nowYear = now.getFullYear();
    const nowMonth = now.getMonth();
    const nowDay = now.getDate();

    // Today - just show time
    if (dateYear === nowYear && dateMonth === nowMonth && dateDay === nowDay) {
      return timeStr;
    }

    // Yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (
      dateYear === yesterday.getFullYear() &&
      dateMonth === yesterday.getMonth() &&
      dateDay === yesterday.getDate()
    ) {
      return `Yesterday ${timeStr}`;
    }

    // Same year
    if (dateYear === nowYear) {
      return `${this.getMonthAbbr(dateMonth)} ${dateDay} ${timeStr}`;
    }

    // Different year
    return `${dateYear} ${this.getMonthAbbr(dateMonth)} ${dateDay} ${timeStr}`;
  }

  private formatFull(date: Date, now: Date): string {
    const timeStr = this.formatTime(date);
    const dateYear = date.getFullYear();
    const dateMonth = date.getMonth();
    const dateDay = date.getDate();
    const nowYear = now.getFullYear();

    if (dateYear === nowYear) {
      return `${this.getMonthAbbr(dateMonth)} ${dateDay} ${timeStr}`;
    }

    return `${dateYear} ${this.getMonthAbbr(dateMonth)} ${dateDay} ${timeStr}`;
  }

  private formatTime(date: Date): string {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    const minuteStr = minutes.toString().padStart(2, '0');
    return `${hour12}:${minuteStr} ${ampm}`;
  }

  private getMonthAbbr(month: number): string {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return months[month];
  }
}
