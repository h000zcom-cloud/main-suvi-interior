const signatures = [
  { title: "Design", note: "Spaces shaped around real life." },
  { title: "Make", note: "Furniture resolved to the millimetre." },
  { title: "Install", note: "One team through the final detail." },
];

export const Strip = () => (
  <section className="signature-strip" data-testid="studio-signature-strip" aria-label="The Suvi approach">
    <div className="container-x signature-strip-inner">
      {signatures.map((item, index) => (
        <div className="signature-item" key={item.title}>
          <span className="signature-index">0{index + 1}</span>
          <p className="signature-title">{item.title}</p>
          <p className="signature-note">{item.note}</p>
        </div>
      ))}
    </div>
  </section>
);
