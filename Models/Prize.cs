namespace BankerGameWeb.Models
{
    public class Prize
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public decimal Value { get; set; }
        public string Description { get; set; } = string.Empty;
        public bool IsRevealed { get; set; }
        public string Color { get; set; } = "#FFD700";
    }
}
