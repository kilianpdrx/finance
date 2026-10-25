import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CategorySourceBadge } from './category-source-badge';

describe('CategorySourceBadge', () => {
  it('says whether a rule or the user chose the category', () => {
    const { rerender, container } = render(<CategorySourceBadge source="rule" />);
    expect(screen.getByTitle('Classée automatiquement par une règle')).toHaveTextContent('auto');
    rerender(<CategorySourceBadge source="manual" />);
    expect(screen.getByTitle('Catégorie choisie à la main')).toHaveTextContent('manuel');
    rerender(<CategorySourceBadge source={null} />);                  // no category: nobody chose
    expect(container).toBeEmptyDOMElement();
    rerender(<CategorySourceBadge source="manual" showManual={false} />);  // the Transactions list marks only « auto »
    expect(container).toBeEmptyDOMElement();
  });
});
