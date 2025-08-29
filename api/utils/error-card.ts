import {Card} from '../../src/templates/card';
import {Theme, ThemeMap} from '../../src/const/theme';

export const getErrorMsgCard = function (msg: string, themeName: string) {
    const baseTheme: Theme = ThemeMap.get(themeName)!;
    // Shallow copy to avoid mutating shared theme state
    const theme = new Theme(
        'red',
        baseTheme.text,
        baseTheme.background,
        baseTheme.stroke,
        baseTheme.strokeOpacity,
        baseTheme.icon,
        baseTheme.chart
    );

    const card = new Card('ERROR!!!', 340, 200, theme);
    const svg = card.getSVG();
    const panel = svg.append('g').attr('transform', `translate(30,20)`);
    panel.append('text').attr('y', `${card.yPadding}`).style('font-size', `14px`).style('fill', 'red').text(msg);

    return card.toString();
};
