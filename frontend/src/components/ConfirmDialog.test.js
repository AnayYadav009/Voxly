import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmDialog from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('does not render when open=false', () => {
    const { container } = render(
      <ConfirmDialog open={false} options={[]} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders title, message, and option buttons when open', () => {
    render(
      <ConfirmDialog
        open={true}
        title="Confirm action"
        message="Are you sure?"
        options={['Yes', 'No']}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Confirm action')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('calls onConfirm with the selected option', () => {
    const onConfirm = jest.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Pick one"
        options={['Option A', 'Option B']}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Option A'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0].label).toBe('Option A');
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        open={true}
        title="Pick one"
        options={['X']}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
